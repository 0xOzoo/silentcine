/**
 * SilentCine Audio Extraction & Transcoding Worker
 *
 * Runs locally alongside the Vite dev server (requires ffmpeg installed).
 * Receives extraction/transcoding requests from the frontend, downloads
 * the video from Supabase Storage, processes with ffmpeg, uploads results
 * back, and updates the movies table.
 *
 * Endpoints:
 *   POST /extract           — Extract audio + subtitles from a video
 *   POST /transcode         — Generate multi-quality video variants (720p/1080p/4K)
 *   POST /upload-subtitle   — Upload external SRT file, convert to VTT
 *   GET  /status/:id        — Check job status for a movie
 *   GET  /health            — Health check
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const express = require("express");
const cors = require("cors");
const multer = require("multer");
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
app.use(express.json({ limit: "5mb" }));

// Multer config for SRT file uploads (max 2MB — subtitles are small text files)
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(srt|vtt|ass|ssa|sub)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only subtitle files (SRT, VTT, ASS, SSA, SUB) are accepted"));
    }
  },
});

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
  const tmpFiles = [videoTmpPath]; // track all tmp files for cleanup

  try {
    // 1. Download video from Supabase Storage
    console.log(`${logPrefix} Downloading video from storage...`);
    activeJobs.set(movieId, { status: "downloading", progress: 5 });

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

    // 2. Probe the file for audio + subtitle streams
    console.log(`${logPrefix} Probing file for streams...`);
    activeJobs.set(movieId, { status: "probing", progress: 10 });
    const probeResult = await probeFile(videoTmpPath);
    console.log(`${logPrefix} Found: ${probeResult.audioStreams} audio, ${probeResult.subtitleStreams} subtitle streams`);

    if (probeResult.audioStreams === 0) {
      throw new Error("Video file contains no audio streams");
    }

    // ── 3. Extract all audio tracks ─────────────────────────────
    // Allocate 10-60% progress for audio extraction
    const audioTrackResults = [];
    const totalAudioTracks = probeResult.audioTracks.length;

    for (let i = 0; i < totalAudioTracks; i++) {
      const track = probeResult.audioTracks[i];
      const audioTmpPath = path.join(TMP_DIR, `${movieId}_audio_${i}_${jobId}.mp3`);
      tmpFiles.push(audioTmpPath);

      const trackLabel = track.language || track.title || `Track ${i}`;
      console.log(`${logPrefix} Extracting audio track ${i} (${trackLabel})...`);

      const baseProgress = 10 + (i / totalAudioTracks) * 50;
      activeJobs.set(movieId, {
        status: "extracting_audio",
        progress: Math.round(baseProgress),
        currentTrack: `Audio ${i + 1}/${totalAudioTracks}`,
      });

      await extractAudioTrack(videoTmpPath, audioTmpPath, track.streamIndex, probeResult.duration, (pct) => {
        const progress = baseProgress + (pct / 100) * (50 / totalAudioTracks);
        activeJobs.set(movieId, {
          status: "extracting_audio",
          progress: Math.round(progress),
          currentTrack: `Audio ${i + 1}/${totalAudioTracks}`,
        });
      });

      // Upload this audio track
      const audioBuffer = fs.readFileSync(audioTmpPath);
      const audioStoragePath = totalAudioTracks === 1
        ? `audio/${movieId}.mp3`
        : `audio/${movieId}_track${i}.mp3`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(audioStoragePath, audioBuffer, {
          contentType: "audio/mpeg",
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        console.error(`${logPrefix} Failed to upload audio track ${i}:`, uploadError.message);
        continue; // Skip this track but continue with others
      }

      console.log(`${logPrefix} Audio track ${i} uploaded: ${audioStoragePath} (${formatBytes(audioBuffer.length)})`);
      audioTrackResults.push({
        ...track,
        storagePath: audioStoragePath,
        label: track.title || (track.language ? `${track.language.toUpperCase()}` : `Audio ${i + 1}`),
      });

      // Cleanup tmp immediately
      cleanupFile(audioTmpPath);
    }

    // The "primary" audio path is track 0 for backward compatibility
    const primaryAudioPath = audioTrackResults[0]?.storagePath || `audio/${movieId}.mp3`;

    // ── 4. Extract embedded subtitles ───────────────────────────
    // Allocate 60-85% progress for subtitle extraction
    const subtitleTrackResults = [];
    const textSubtitles = probeResult.subtitleTracks.filter((s) => !s.isImageBased);

    if (textSubtitles.length > 0) {
      console.log(`${logPrefix} Extracting ${textSubtitles.length} text subtitle tracks...`);

      for (let i = 0; i < textSubtitles.length; i++) {
        const subTrack = textSubtitles[i];
        const vttTmpPath = path.join(TMP_DIR, `${movieId}_sub_${i}_${jobId}.vtt`);
        tmpFiles.push(vttTmpPath);

        const trackLabel = subTrack.language || subTrack.title || `Subtitle ${i}`;
        console.log(`${logPrefix} Extracting subtitle track ${i} (${trackLabel}, codec: ${subTrack.codec})...`);

        activeJobs.set(movieId, {
          status: "extracting_subtitles",
          progress: 60 + Math.round((i / textSubtitles.length) * 25),
          currentTrack: `Subtitle ${i + 1}/${textSubtitles.length}`,
        });

        try {
          await extractSubtitleTrack(videoTmpPath, vttTmpPath, subTrack.streamIndex);

          // Read VTT content and upload
          const vttContent = fs.readFileSync(vttTmpPath, "utf-8");
          if (vttContent.trim().length < 10) {
            console.log(`${logPrefix} Subtitle track ${i} is empty, skipping`);
            continue;
          }

          const subStoragePath = `subtitles/${movieId}_track${i}.vtt`;

          const { error: subUploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(subStoragePath, vttContent, {
              contentType: "text/vtt",
              cacheControl: "3600",
              upsert: true,
            });

          if (subUploadError) {
            console.error(`${logPrefix} Failed to upload subtitle track ${i}:`, subUploadError.message);
            continue;
          }

          console.log(`${logPrefix} Subtitle track ${i} uploaded: ${subStoragePath}`);
          subtitleTrackResults.push({
            ...subTrack,
            storagePath: subStoragePath,
            format: "vtt",
            label: subTrack.title || (subTrack.language ? `${subTrack.language.toUpperCase()}` : `Subtitle ${i + 1}`),
          });
        } catch (subErr) {
          console.error(`${logPrefix} Failed to extract subtitle track ${i}:`, subErr.message);
          // Non-fatal — continue with other tracks
        }

        cleanupFile(vttTmpPath);
      }
    }

    // Log image-based subtitle warning
    const imageSubtitles = probeResult.subtitleTracks.filter((s) => s.isImageBased);
    if (imageSubtitles.length > 0) {
      console.log(`${logPrefix} Skipping ${imageSubtitles.length} image-based subtitle tracks (PGS/VobSub — not supported for text extraction)`);
    }

    // ── 5. Update movies table with all results ─────────────────
    activeJobs.set(movieId, { status: "ready", progress: 100 });
    await updateMovieStatus(movieId, "ready", primaryAudioPath, null, {
      ...probeResult,
      audioTracks: audioTrackResults,
      subtitleTracks: subtitleTrackResults,
    });

    console.log(`${logPrefix} Extraction complete! ${audioTrackResults.length} audio, ${subtitleTrackResults.length} subtitle tracks`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} Extraction failed:`, errorMsg);

    activeJobs.set(movieId, { status: "error", progress: 0, error: errorMsg });
    await updateMovieStatus(movieId, "error", null, errorMsg);
  } finally {
    // Cleanup all tmp files
    tmpFiles.forEach(cleanupFile);

    // Remove from active jobs after 5 minutes (allow status polling)
    setTimeout(() => {
      activeJobs.delete(movieId);
    }, 5 * 60 * 1000);
  }
}

// ── ffprobe ─────────────────────────────────────────────────────────

/**
 * Probe a file for audio streams, subtitle streams, duration, and codec info.
 * @returns {{
 *   audioStreams: number,
 *   subtitleStreams: number,
 *   duration: number,
 *   audioCodec: string|null,
 *   audioTracks: object[],
 *   subtitleTracks: object[]
 * }}
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
        const allStreams = info.streams || [];
        const audioStreams = allStreams.filter((s) => s.codec_type === "audio");
        const subtitleStreams = allStreams.filter((s) => s.codec_type === "subtitle");
        const duration = parseFloat(info.format?.duration || "0");

        const audioTracks = audioStreams.map((s, i) => ({
          index: i,
          streamIndex: s.index,  // absolute stream index in the file
          codec: s.codec_name,
          channels: s.channels,
          sampleRate: parseInt(s.sample_rate || "0", 10),
          language: s.tags?.language || null,
          title: s.tags?.title || null,
        }));

        const subtitleTracks = subtitleStreams.map((s, i) => ({
          index: i,
          streamIndex: s.index,  // absolute stream index in the file
          codec: s.codec_name,   // subrip, ass, mov_text, webvtt, dvd_subtitle, hdmv_pgs_subtitle, etc.
          language: s.tags?.language || null,
          title: s.tags?.title || null,
          isImageBased: ["dvd_subtitle", "hdmv_pgs_subtitle", "dvb_subtitle"].includes(s.codec_name),
        }));

        resolve({
          audioStreams: audioStreams.length,
          subtitleStreams: subtitleStreams.length,
          duration,
          audioCodec: audioStreams[0]?.codec_name || null,
          audioTracks,
          subtitleTracks,
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
 * Extract a specific audio track from video using ffmpeg.
 * Maps from the absolute stream index to get the right track.
 * Converts to MP3 192kbps stereo for maximum device compatibility.
 *
 * @param {string} inputPath - Path to the video file
 * @param {string} outputPath - Path for the output MP3
 * @param {number} streamIndex - Absolute stream index from ffprobe (e.g., 1, 2)
 * @param {number} duration - Duration in seconds (for progress)
 * @param {function} onProgress - Progress callback (0-100)
 */
function extractAudioTrack(inputPath, outputPath, streamIndex, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-map", `0:${streamIndex}`,  // Select specific stream
      "-vn",                       // No video
      "-acodec", "libmp3lame",     // MP3 codec
      "-ab", "192k",               // 192kbps bitrate
      "-ar", "44100",              // 44.1kHz sample rate
      "-ac", "2",                  // Stereo
      "-y",                        // Overwrite output
      "-progress", "pipe:1",       // Progress to stdout
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
        return reject(new Error(`ffmpeg audio extraction exited with code ${code}: ${stderr.slice(-500)}`));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error("ffmpeg completed but output file was not created"));
      }

      const stat = fs.statSync(outputPath);
      if (stat.size < 1024) {
        return reject(new Error("Extracted audio is suspiciously small (< 1KB). The stream may have no usable audio."));
      }

      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg not found or failed to start: ${err.message}`));
    });
  });
}

/**
 * Extract a specific subtitle track from video and convert to WebVTT.
 * ffmpeg can convert most text-based subtitle formats (SRT, ASS, MOV_TEXT) to WebVTT directly.
 *
 * @param {string} inputPath - Path to the video file
 * @param {string} outputPath - Path for the output VTT file
 * @param {number} streamIndex - Absolute stream index from ffprobe
 */
function extractSubtitleTrack(inputPath, outputPath, streamIndex) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-map", `0:${streamIndex}`,  // Select specific subtitle stream
      "-c:s", "webvtt",            // Convert to WebVTT
      "-y",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args);
    let stderr = "";

    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg subtitle extraction exited with code ${code}: ${stderr.slice(-500)}`));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error("ffmpeg completed but subtitle output file was not created"));
      }

      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg not found or failed to start: ${err.message}`));
    });
  });
}

// ── SRT → VTT conversion ────────────────────────────────────────────

/**
 * Convert an SRT file to WebVTT format.
 * SRT and VTT are very similar — mainly the header and timestamp separator differ.
 *
 * @param {string} srtContent - Raw SRT file content
 * @returns {string} WebVTT content
 */
function srtToVtt(srtContent) {
  // Normalize line endings
  let content = srtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  // Replace SRT timestamp format (comma) with VTT format (period)
  // SRT: 00:01:23,456 --> 00:01:25,789
  // VTT: 00:01:23.456 --> 00:01:25.789
  content = content.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    "$1.$2"
  );

  // Remove sequence numbers (lines that are just digits before a timestamp)
  content = content.replace(/^\d+\s*\n(?=\d{2}:\d{2}:\d{2})/gm, "");

  return `WEBVTT\n\n${content}\n`;
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
    if (probeResult.subtitleTracks) {
      update.subtitle_tracks = probeResult.subtitleTracks;
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

// ── POST /upload-subtitle ────────────────────────────────────────────

app.post("/upload-subtitle", requireApiKey, upload.single("file"), async (req, res) => {
  try {
    const { movieId, language, label } = req.body;
    const file = req.file;

    if (!movieId) {
      return res.status(400).json({ error: "movieId is required" });
    }
    if (!file) {
      return res.status(400).json({ error: "No subtitle file provided" });
    }

    const logPrefix = `[Subtitle:${movieId}]`;
    console.log(`${logPrefix} Received external subtitle: ${file.originalname} (${formatBytes(file.size)})`);

    // Read the uploaded file
    let content = fs.readFileSync(file.path, "utf-8");

    // Detect format and convert to VTT if needed
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".srt") {
      console.log(`${logPrefix} Converting SRT → VTT`);
      content = srtToVtt(content);
    } else if (ext === ".vtt") {
      // Already VTT, ensure it has the WEBVTT header
      if (!content.trim().startsWith("WEBVTT")) {
        content = `WEBVTT\n\n${content}`;
      }
    } else if (ext === ".ass" || ext === ".ssa") {
      // Use ffmpeg to convert ASS/SSA → VTT
      console.log(`${logPrefix} Converting ${ext.toUpperCase()} → VTT via ffmpeg`);
      const vttTmpPath = file.path + ".vtt";
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn("ffmpeg", [
            "-i", file.path,
            "-c:s", "webvtt",
            "-y",
            vttTmpPath,
          ]);
          let stderr = "";
          proc.stderr.on("data", (d) => { stderr += d.toString(); });
          proc.on("close", (code) => {
            if (code !== 0) reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
            else resolve();
          });
          proc.on("error", (err) => reject(err));
        });
        content = fs.readFileSync(vttTmpPath, "utf-8");
        cleanupFile(vttTmpPath);
      } catch (convErr) {
        cleanupFile(vttTmpPath);
        throw new Error(`Failed to convert ${ext}: ${convErr.message}`);
      }
    } else {
      cleanupFile(file.path);
      return res.status(400).json({ error: `Unsupported subtitle format: ${ext}` });
    }

    // Generate a unique index for this external subtitle
    // Fetch current movie to see existing subtitle tracks
    const { data: movie, error: fetchErr } = await supabase
      .from("movies")
      .select("subtitle_tracks")
      .eq("id", movieId)
      .single();

    if (fetchErr) {
      throw new Error(`Movie not found: ${fetchErr.message}`);
    }

    const existingTracks = movie.subtitle_tracks || [];
    const newIndex = existingTracks.length;

    // Upload VTT to Supabase Storage
    const subStoragePath = `subtitles/${movieId}_ext${newIndex}.vtt`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(subStoragePath, content, {
        contentType: "text/vtt",
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload subtitle: ${uploadError.message}`);
    }

    // Add to the movie's subtitle_tracks array
    const baseName = path.basename(file.originalname, ext);
    const newTrack = {
      index: newIndex,
      streamIndex: -1, // external, not from a container stream
      codec: "webvtt",
      language: language || null,
      title: label || baseName || null,
      isImageBased: false,
      storagePath: subStoragePath,
      format: "vtt",
      label: label || baseName || `External ${newIndex + 1}`,
      external: true,
    };

    existingTracks.push(newTrack);

    const { error: dbError } = await supabase
      .from("movies")
      .update({ subtitle_tracks: existingTracks })
      .eq("id", movieId);

    if (dbError) {
      console.error(`${logPrefix} DB update failed:`, dbError.message);
    }

    // Get a signed URL for the uploaded subtitle
    const { data: urlData } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(subStoragePath, 3600);

    console.log(`${logPrefix} External subtitle uploaded: ${subStoragePath}`);

    // Cleanup uploaded temp file
    cleanupFile(file.path);

    return res.json({
      success: true,
      track: newTrack,
      signedUrl: urlData?.signedUrl || null,
    });
  } catch (err) {
    // Cleanup uploaded temp file on error
    if (req.file) cleanupFile(req.file.path);

    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Subtitle] Upload failed:", errorMsg);
    return res.status(500).json({ error: errorMsg });
  }
});

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

// ── POST /cleanup ────────────────────────────────────────────────────

/**
 * Deletes Storage files for archived movies.
 * Called by the enforce-retention edge function after archiving movies.
 *
 * POST body: { movieIds: string[] }
 * Returns: { deleted: number, errors: string[] }
 */
app.post("/cleanup", requireApiKey, async (req, res) => {
  const { movieIds } = req.body;

  if (!Array.isArray(movieIds) || movieIds.length === 0) {
    return res.status(400).json({ error: "movieIds array is required" });
  }

  console.log(`[Cleanup] Cleaning up ${movieIds.length} archived movies...`);

  let deleted = 0;
  const errors = [];

  for (const movieId of movieIds) {
    try {
      // Fetch movie to get all storage paths
      const { data: movie, error: fetchErr } = await supabase
        .from("movies")
        .select("id, video_path, audio_path, audio_tracks, subtitle_tracks, variants")
        .eq("id", movieId)
        .single();

      if (fetchErr || !movie) {
        errors.push(`Movie ${movieId}: not found`);
        continue;
      }

      const pathsToDelete = [];

      if (movie.video_path) pathsToDelete.push(movie.video_path);
      if (movie.audio_path) pathsToDelete.push(movie.audio_path);

      // Audio tracks
      if (Array.isArray(movie.audio_tracks)) {
        for (const track of movie.audio_tracks) {
          if (track.storagePath) pathsToDelete.push(track.storagePath);
        }
      }

      // Subtitle tracks
      if (Array.isArray(movie.subtitle_tracks)) {
        for (const track of movie.subtitle_tracks) {
          if (track.storagePath) pathsToDelete.push(track.storagePath);
        }
      }

      // Video variants
      if (Array.isArray(movie.variants)) {
        for (const variant of movie.variants) {
          if (variant.path) pathsToDelete.push(variant.path);
        }
      }

      if (pathsToDelete.length > 0) {
        const { error: deleteErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(pathsToDelete);

        if (deleteErr) {
          errors.push(`Movie ${movieId}: storage delete failed - ${deleteErr.message}`);
        } else {
          deleted += pathsToDelete.length;
          console.log(`[Cleanup] Deleted ${pathsToDelete.length} files for movie ${movieId}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Movie ${movieId}: ${msg}`);
    }
  }

  console.log(`[Cleanup] Done. Deleted ${deleted} files, ${errors.length} errors.`);

  return res.json({ deleted, errors });
});

// ── Start server ────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  SilentCine Worker listening on http://0.0.0.0:${PORT}`);
  console.log(`  Max concurrent extractions: ${MAX_CONCURRENT}`);
  console.log(`  Temp directory: ${TMP_DIR}`);
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  API key: ${API_KEY.slice(0, 8)}...\n`);
});
