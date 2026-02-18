/**
 * SilentCine Audio Extraction & Transcoding Worker
 *
 * Runs locally alongside the Vite dev server (requires ffmpeg installed).
 * Receives extraction/transcoding requests from the frontend, downloads
 * the video from Supabase Storage, processes with ffmpeg, uploads results
 * back, and updates the movies table.
 *
 * Endpoints:
 *   POST /extract      — Extract audio from a video
 *   POST /transcode    — Generate multi-quality video variants (720p/1080p/4K)
 *   GET  /status/:id   — Check job status for a movie
 *   GET  /health       — Health check
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Config ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3001", 10);
const API_KEY = process.env.API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TMP_DIR = path.resolve(process.env.TMP_DIR || "./tmp");
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || "2", 10);
const STORAGE_BUCKET = "movies";

// ── Validation ──────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

if (!API_KEY) {
  console.error("FATAL: API_KEY is required for request authentication");
  process.exit(1);
}

// ── Supabase client (service role — full DB/Storage access) ─────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── State ───────────────────────────────────────────────────────────

/** @type {Map<string, { status: string, progress: number, error?: string }>} */
const activeJobs = new Map();
let runningCount = 0;

/** @type {Array<{ movieId: string, videoPath: string }>} */
const queue = [];

// ── Ensure tmp directory ────────────────────────────────────────────

fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Express app ─────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ── Auth middleware ─────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    console.warn(`[Auth] Rejected: received key="${key ? key.slice(0, 8) + '...' : '(none)'}", expected="${API_KEY.slice(0, 8)}..."`);
    return res.status(401).json({ error: "Invalid or missing x-api-key" });
  }
  next();
}

// ── Health check ────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    running: runningCount,
    queued: queue.length,
    maxConcurrent: MAX_CONCURRENT,
  });
});

// ── POST /extract ───────────────────────────────────────────────────

app.post("/extract", requireApiKey, (req, res) => {
  const { movieId, videoPath } = req.body;

  if (!movieId || !videoPath) {
    return res.status(400).json({ error: "movieId and videoPath are required" });
  }

  // Check if already processing
  if (activeJobs.has(movieId)) {
    const job = activeJobs.get(movieId);
    return res.json({ accepted: true, status: job.status, movieId });
  }

  // Enqueue
  activeJobs.set(movieId, { status: "queued", progress: 0 });
  queue.push({ movieId, videoPath });

  console.log(`[Extract] Queued movieId=${movieId} videoPath=${videoPath}`);

  // Try to start processing
  processQueue();

  return res.json({ accepted: true, status: "queued", movieId });
});

// ── GET /status/:movieId ────────────────────────────────────────────

app.get("/status/:movieId", requireApiKey, (req, res) => {
  const { movieId } = req.params;
  const job = activeJobs.get(movieId);

  if (!job) {
    return res.status(404).json({ error: "No active job for this movieId" });
  }

  return res.json({ movieId, ...job });
});

// ── POST /transcode ─────────────────────────────────────────────────

/** @type {Array<{ movieId: string, videoPath: string, qualities: string[] }>} */
const transcodeQueue = [];

app.post("/transcode", requireApiKey, (req, res) => {
  const { movieId, videoPath, qualities } = req.body;

  if (!movieId || !videoPath) {
    return res.status(400).json({ error: "movieId and videoPath are required" });
  }

  const validQualities = ["720p", "1080p", "4k_hdr"];
  const requestedQualities = (qualities || ["720p"]).filter((q) => validQualities.includes(q));

  if (requestedQualities.length === 0) {
    return res.status(400).json({ error: "No valid qualities requested" });
  }

  // Check if already processing
  const jobKey = `transcode:${movieId}`;
  if (activeJobs.has(jobKey)) {
    const job = activeJobs.get(jobKey);
    return res.json({ accepted: true, status: job.status, movieId, qualities: requestedQualities });
  }

  activeJobs.set(jobKey, { status: "queued", progress: 0, qualities: requestedQualities });
  transcodeQueue.push({ movieId, videoPath, qualities: requestedQualities });

  console.log(`[Transcode] Queued movieId=${movieId} qualities=${requestedQualities.join(",")}`);

  processQueue();

  return res.json({ accepted: true, status: "queued", movieId, qualities: requestedQualities });
});

// ── Quality presets ─────────────────────────────────────────────────

const QUALITY_PRESETS = {
  "720p": {
    scale: "1280:720",
    preset: "fast",
    crf: "23",
    maxrate: "2500k",
    bufsize: "5000k",
    label: "720p",
  },
  "1080p": {
    scale: "1920:1080",
    preset: "medium",
    crf: "23",
    maxrate: "5000k",
    bufsize: "10000k",
    label: "1080p",
  },
  "4k_hdr": {
    scale: "3840:2160",
    preset: "slow",
    crf: "22",
    maxrate: "15000k",
    bufsize: "30000k",
    label: "4K",
  },
};

// ── Queue processor ─────────────────────────────────────────────────

function processQueue() {
  while (runningCount < MAX_CONCURRENT) {
    // Prioritize extraction over transcoding
    if (queue.length > 0) {
      const job = queue.shift();
      if (job) {
        runningCount++;
        runExtraction(job.movieId, job.videoPath).finally(() => {
          runningCount--;
          processQueue();
        });
      }
    } else if (transcodeQueue.length > 0) {
      const job = transcodeQueue.shift();
      if (job) {
        runningCount++;
        runTranscode(job.movieId, job.videoPath, job.qualities).finally(() => {
          runningCount--;
          processQueue();
        });
      }
    } else {
      break;
    }
  }
}

// ── Extraction pipeline ─────────────────────────────────────────────

async function runExtraction(movieId, videoPath) {
  const jobId = crypto.randomBytes(4).toString("hex");
  const logPrefix = `[Extract:${jobId}:${movieId}]`;

  console.log(`${logPrefix} Starting extraction for ${videoPath}`);
  activeJobs.set(movieId, { status: "processing", progress: 0 });

  // Update DB status to processing
  await updateMovieStatus(movieId, "processing");

  const videoTmpPath = path.join(TMP_DIR, `${movieId}_video_${jobId}`);
  const audioTmpPath = path.join(TMP_DIR, `${movieId}_audio_${jobId}.mp3`);

  try {
    // 1. Download video from Supabase Storage
    console.log(`${logPrefix} Downloading video from storage...`);
    activeJobs.set(movieId, { status: "downloading", progress: 10 });

    const { data: downloadData, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(videoPath);

    if (downloadError || !downloadData) {
      throw new Error(`Failed to download video: ${downloadError?.message || "No data"}`);
    }

    // Write to tmp file
    const buffer = Buffer.from(await downloadData.arrayBuffer());
    fs.writeFileSync(videoTmpPath, buffer);
    console.log(`${logPrefix} Downloaded ${formatBytes(buffer.length)} to ${videoTmpPath}`);

    // 2. Probe the file for audio streams
    console.log(`${logPrefix} Probing file for audio streams...`);
    const probeResult = await probeFile(videoTmpPath);
    console.log(`${logPrefix} Probe result:`, JSON.stringify(probeResult));

    if (probeResult.audioStreams === 0) {
      throw new Error("Video file contains no audio streams");
    }

    // 3. Extract audio with ffmpeg
    console.log(`${logPrefix} Extracting audio with ffmpeg...`);
    activeJobs.set(movieId, { status: "extracting", progress: 30 });

    await extractAudioWithFfmpeg(videoTmpPath, audioTmpPath, probeResult.duration, (progress) => {
      activeJobs.set(movieId, { status: "extracting", progress: 30 + Math.floor(progress * 0.5) });
    });

    // 4. Upload extracted audio to Supabase Storage
    console.log(`${logPrefix} Uploading extracted audio...`);
    activeJobs.set(movieId, { status: "uploading", progress: 85 });

    const audioBuffer = fs.readFileSync(audioTmpPath);
    const audioPath = `audio/${movieId}.mp3`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(audioPath, audioBuffer, {
        contentType: "audio/mpeg",
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    console.log(`${logPrefix} Audio uploaded to ${audioPath} (${formatBytes(audioBuffer.length)})`);

    // 5. Update movies table with success
    activeJobs.set(movieId, { status: "ready", progress: 100 });
    await updateMovieStatus(movieId, "ready", audioPath, null, probeResult);

    console.log(`${logPrefix} Extraction complete!`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} Extraction failed:`, errorMsg);

    activeJobs.set(movieId, { status: "error", progress: 0, error: errorMsg });
    await updateMovieStatus(movieId, "error", null, errorMsg);
  } finally {
    // Cleanup tmp files
    cleanupFile(videoTmpPath);
    cleanupFile(audioTmpPath);

    // Remove from active jobs after 5 minutes (allow status polling)
    setTimeout(() => {
      activeJobs.delete(movieId);
    }, 5 * 60 * 1000);
  }
}

// ── ffprobe ─────────────────────────────────────────────────────────

/**
 * Probe a file for audio stream count, duration, and codec info.
 * @returns {{ audioStreams: number, duration: number, audioCodec: string|null, audioTracks: object[] }}
 */
function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];

    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }

      try {
        const info = JSON.parse(stdout);
        const audioStreams = (info.streams || []).filter((s) => s.codec_type === "audio");
        const duration = parseFloat(info.format?.duration || "0");
        const audioTracks = audioStreams.map((s, i) => ({
          index: i,
          codec: s.codec_name,
          channels: s.channels,
          sampleRate: parseInt(s.sample_rate || "0", 10),
          language: s.tags?.language || null,
          title: s.tags?.title || null,
        }));

        resolve({
          audioStreams: audioStreams.length,
          duration,
          audioCodec: audioStreams[0]?.codec_name || null,
          audioTracks,
        });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`ffprobe not found or failed to start: ${err.message}`));
    });
  });
}

// ── ffmpeg extraction ───────────────────────────────────────────────

/**
 * Extract audio from video using ffmpeg.
 * Converts to MP3 192kbps stereo for maximum device compatibility.
 */
function extractAudioWithFfmpeg(inputPath, outputPath, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-vn",                     // No video
      "-acodec", "libmp3lame",   // MP3 codec
      "-ab", "192k",             // 192kbps bitrate
      "-ar", "44100",            // 44.1kHz sample rate
      "-ac", "2",                // Stereo
      "-y",                      // Overwrite output
      "-progress", "pipe:1",     // Progress to stdout
      outputPath,
    ];

    const proc = spawn("ffmpeg", args);
    let stderr = "";

    proc.stdout.on("data", (data) => {
      const output = data.toString();
      // Parse progress: "out_time_ms=12345678\n"
      const match = output.match(/out_time_ms=(\d+)/);
      if (match && duration > 0) {
        const currentSec = parseInt(match[1], 10) / 1_000_000;
        const pct = Math.min(100, (currentSec / duration) * 100);
        onProgress(pct);
      }
    });

    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }

      // Verify output file exists and has content
      if (!fs.existsSync(outputPath)) {
        return reject(new Error("ffmpeg completed but output file was not created"));
      }

      const stat = fs.statSync(outputPath);
      if (stat.size < 1024) {
        return reject(new Error("Extracted audio is suspiciously small (< 1KB). The video may have no usable audio."));
      }

      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg not found or failed to start: ${err.message}`));
    });
  });
}

// ── Transcode pipeline ──────────────────────────────────────────────

async function runTranscode(movieId, videoPath, qualities) {
  const jobKey = `transcode:${movieId}`;
  const jobId = crypto.randomBytes(4).toString("hex");
  const logPrefix = `[Transcode:${jobId}:${movieId}]`;

  console.log(`${logPrefix} Starting transcode for ${videoPath} → [${qualities.join(", ")}]`);
  activeJobs.set(jobKey, { status: "processing", progress: 0, qualities });

  const videoTmpPath = path.join(TMP_DIR, `${movieId}_video_${jobId}`);
  const tmpOutputs = [];

  try {
    // 1. Download video from Supabase Storage
    console.log(`${logPrefix} Downloading video from storage...`);
    activeJobs.set(jobKey, { status: "downloading", progress: 5, qualities });

    const { data: downloadData, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(videoPath);

    if (downloadError || !downloadData) {
      throw new Error(`Failed to download video: ${downloadError?.message || "No data"}`);
    }

    const buffer = Buffer.from(await downloadData.arrayBuffer());
    fs.writeFileSync(videoTmpPath, buffer);
    console.log(`${logPrefix} Downloaded ${formatBytes(buffer.length)}`);

    // 2. Probe for video stream info
    const probeResult = await probeFile(videoTmpPath);
    const sourceHeight = await getVideoHeight(videoTmpPath);
    console.log(`${logPrefix} Source height: ${sourceHeight}p, duration: ${probeResult.duration}s`);

    // 3. Process each quality (720p first for fastest availability)
    // Sort: 720p → 1080p → 4k_hdr
    const sortOrder = { "720p": 0, "1080p": 1, "4k_hdr": 2 };
    const sorted = [...qualities].sort((a, b) => (sortOrder[a] || 0) - (sortOrder[b] || 0));

    const variants = [];
    const totalQualities = sorted.length;

    for (let qi = 0; qi < sorted.length; qi++) {
      const quality = sorted[qi];
      const preset = QUALITY_PRESETS[quality];
      if (!preset) continue;

      // Skip upscaling: don't transcode to a higher resolution than the source
      const targetHeight = parseInt(preset.scale.split(":")[1], 10);
      if (targetHeight > sourceHeight) {
        console.log(`${logPrefix} Skipping ${quality} (source is only ${sourceHeight}p)`);
        continue;
      }

      const baseProgress = 10 + (qi / totalQualities) * 80;
      activeJobs.set(jobKey, {
        status: `transcoding_${quality}`,
        progress: Math.round(baseProgress),
        qualities,
        currentQuality: quality,
      });

      const outputPath = path.join(TMP_DIR, `${movieId}_${quality}_${jobId}.mp4`);
      tmpOutputs.push(outputPath);

      console.log(`${logPrefix} Transcoding to ${quality}...`);

      await transcodeVideo(videoTmpPath, outputPath, preset, probeResult.duration, (pct) => {
        const progress = baseProgress + (pct / 100) * (80 / totalQualities);
        activeJobs.set(jobKey, {
          status: `transcoding_${quality}`,
          progress: Math.round(progress),
          qualities,
          currentQuality: quality,
        });
      });

      // Upload variant to Supabase Storage
      const storagePath = `variants/${movieId}/${quality}.mp4`;
      const variantBuffer = fs.readFileSync(outputPath);

      console.log(`${logPrefix} Uploading ${quality} variant (${formatBytes(variantBuffer.length)})...`);

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, variantBuffer, {
          contentType: "video/mp4",
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        console.error(`${logPrefix} Upload failed for ${quality}:`, uploadError.message);
        continue; // Skip this variant but continue with others
      }

      const stat = fs.statSync(outputPath);
      variants.push({
        quality,
        path: storagePath,
        size: stat.size,
        bitrate: parseInt(preset.maxrate, 10),
        resolution: preset.scale.replace(":", "x"),
      });

      console.log(`${logPrefix} ${quality} variant uploaded: ${storagePath}`);

      // Clean up this output file immediately to save disk space
      cleanupFile(outputPath);
    }

    // 4. Update movies table with variants
    activeJobs.set(jobKey, { status: "ready", progress: 100, qualities, variants });

    const { error: dbError } = await supabase
      .from("movies")
      .update({ variants: variants })
      .eq("id", movieId);

    if (dbError) {
      console.error(`${logPrefix} DB update failed:`, dbError.message);
    }

    console.log(`${logPrefix} Transcode complete! ${variants.length} variants generated`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} Transcode failed:`, errorMsg);
    activeJobs.set(jobKey, { status: "error", progress: 0, error: errorMsg, qualities });
  } finally {
    cleanupFile(videoTmpPath);
    tmpOutputs.forEach(cleanupFile);

    setTimeout(() => {
      activeJobs.delete(jobKey);
    }, 5 * 60 * 1000);
  }
}

/**
 * Transcode a video to a specific quality preset using ffmpeg.
 */
function transcodeVideo(inputPath, outputPath, preset, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-vf", `scale=${preset.scale}:force_original_aspect_ratio=decrease,pad=${preset.scale}:(ow-iw)/2:(oh-ih)/2`,
      "-c:v", "libx264",
      "-preset", preset.preset,
      "-crf", preset.crf,
      "-maxrate", preset.maxrate,
      "-bufsize", preset.bufsize,
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",  // Web-optimized MP4
      "-y",
      "-progress", "pipe:1",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args);
    let stderr = "";

    proc.stdout.on("data", (data) => {
      const output = data.toString();
      const match = output.match(/out_time_ms=(\d+)/);
      if (match && duration > 0) {
        const currentSec = parseInt(match[1], 10) / 1_000_000;
        const pct = Math.min(100, (currentSec / duration) * 100);
        onProgress(pct);
      }
    });

    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg transcode exited with code ${code}: ${stderr.slice(-500)}`));
      }
      if (!fs.existsSync(outputPath)) {
        return reject(new Error("ffmpeg completed but output file was not created"));
      }
      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg not found or failed to start: ${err.message}`));
    });
  });
}

/**
 * Get the video height from a file (for upscale prevention).
 */
function getVideoHeight(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-select_streams", "v:0",
      filePath,
    ];

    const proc = spawn("ffprobe", args);
    let stdout = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) return resolve(720); // Default to 720p on error
      try {
        const info = JSON.parse(stdout);
        const videoStream = (info.streams || [])[0];
        resolve(videoStream?.height || 720);
      } catch {
        resolve(720);
      }
    });
    proc.on("error", () => resolve(720));
  });
}

// ── DB update ───────────────────────────────────────────────────────

async function updateMovieStatus(movieId, status, audioPath = null, error = null, probeResult = null) {
  const update = { status };
  if (audioPath) update.audio_path = audioPath;
  if (error) update.processing_error = error;
  if (probeResult) {
    update.has_audio_extracted = status === "ready";
    if (probeResult.audioTracks) {
      update.audio_tracks = probeResult.audioTracks;
    }
  }

  const { error: dbError } = await supabase
    .from("movies")
    .update(update)
    .eq("id", movieId);

  if (dbError) {
    console.error(`[DB] Failed to update movie ${movieId}:`, dbError.message);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Start server ────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  SilentCine Worker listening on http://0.0.0.0:${PORT}`);
  console.log(`  Max concurrent extractions: ${MAX_CONCURRENT}`);
  console.log(`  Temp directory: ${TMP_DIR}`);
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  API key: ${API_KEY.slice(0, 8)}...\n`);
});
