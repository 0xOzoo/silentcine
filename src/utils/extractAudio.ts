import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log("[AudioExtract]", ...args);
};

/** Maximum file size for mobile extraction (500MB — keeps WASM memory under control). */
const MAX_EXTRACTION_SIZE_MOBILE = 500 * 1024 * 1024;

/** Maximum file size for desktop extraction (4GB — WASM 32-bit address space ceiling). */
const MAX_EXTRACTION_SIZE_DESKTOP = 4 * 1024 * 1024 * 1024;

/** Minimum file size to bother extracting (< 1MB is probably already audio) */
const MIN_EXTRACTION_SIZE = 1 * 1024 * 1024;

/**
 * Detect if the host is running on a mobile device.
 * Uses a combination of user agent, pointer capability, and viewport width.
 * Exported so HostSession can use it for pre-upload guards.
 */
export function isMobileHost(): boolean {
  const ua = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
  const coarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrowViewport = typeof window !== "undefined" && window.innerWidth < 1024;
  // Must match at least 2 of 3 signals to avoid false positives (e.g. desktop with touch)
  return [ua, coarsePointer, narrowViewport].filter(Boolean).length >= 2;
}

/**
 * Get the file size limit for the current device.
 * Desktop: 4GB (WASM 32-bit ceiling), Mobile: 500MB.
 */
export function getFileSizeLimit(): number {
  return isMobileHost() ? MAX_EXTRACTION_SIZE_MOBILE : MAX_EXTRACTION_SIZE_DESKTOP;
}

export interface ExtractionProgress {
  /** Current phase: 'loading' ffmpeg core, 'extracting' audio, 'done' */
  phase: "loading" | "extracting" | "done";
  /** 0-100 percent within the current phase */
  percent: number;
  /** Human-readable status message */
  message: string;
}

export class ExtractionError extends Error {
  /** Whether the user should be shown a fallback message with converter link */
  public readonly showFallback: boolean;

  constructor(message: string, showFallback = true) {
    super(message);
    this.name = "ExtractionError";
    this.showFallback = showFallback;
  }
}

// Singleton FFmpeg instance — reused across calls, loaded once
let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Check if SharedArrayBuffer is available (needed for multi-threaded ffmpeg core).
 * Requires COOP/COEP headers on the page.
 */
function isSharedArrayBufferAvailable(): boolean {
  try {
    return typeof SharedArrayBuffer !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Load the ffmpeg.wasm core (lazy, cached after first call).
 * Downloads ~25MB of WASM from CDN on first use, then cached by browser.
 */
async function getFFmpeg(
  onProgress?: (p: ExtractionProgress) => void
): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) {
    return ffmpegInstance;
  }

  // If a load is already in progress, wait for it
  if (loadPromise) {
    await loadPromise;
    if (ffmpegInstance?.loaded) return ffmpegInstance;
  }

  const ffmpeg = new FFmpeg();
  ffmpegInstance = ffmpeg;

  // Wire up log output for debugging
  ffmpeg.on("log", ({ message }) => {
    log("ffmpeg:", message);
  });

  loadPromise = (async () => {
    onProgress?.({
      phase: "loading",
      percent: 0,
      message: "Loading audio processor...",
    });

    const useMultiThread = isSharedArrayBufferAvailable();
    log(
      `Loading ffmpeg core (${useMultiThread ? "multi-threaded" : "single-threaded"})`
    );

    // Use the single-threaded core from unpkg CDN.
    // Multi-threaded requires COOP/COEP headers which break external resource loading.
    // The @ffmpeg/core package version must match @ffmpeg/ffmpeg expectations.
    const CORE_VERSION = "0.12.6";
    const baseURL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

    try {
      // Convert CDN URLs to blob URLs to avoid CORS issues with some deployment configs
      const coreURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.js`,
        "text/javascript",
        true,
        (e) => {
          onProgress?.({
            phase: "loading",
            percent: Math.round(e.received / (e.total || 1) * 50),
            message: "Downloading audio processor...",
          });
        }
      );
      const wasmURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm",
        true,
        (e) => {
          onProgress?.({
            phase: "loading",
            percent: 50 + Math.round(e.received / (e.total || 1) * 50),
            message: "Downloading audio processor...",
          });
        }
      );

      await ffmpeg.load({ coreURL, wasmURL });
    } catch (err) {
      ffmpegInstance = null;
      loadPromise = null;
      log("Failed to load ffmpeg core:", err);
      throw new ExtractionError(
        "Failed to load the audio processor. Check your internet connection and try again.",
        false
      );
    }

    onProgress?.({
      phase: "loading",
      percent: 100,
      message: "Audio processor ready",
    });
  })();

  await loadPromise;
  return ffmpeg;
}

/**
 * Check if a file is a video type that needs audio extraction.
 * Audio files are passed through without extraction.
 */
export function isVideoFile(file: File): boolean {
  const videoTypes = [
    "video/mp4",
    "video/webm",
    "video/x-matroska",
    "video/mkv",
    "video/quicktime",
    "video/avi",
    "video/x-msvideo",
    "video/ogg",
  ];
  if (videoTypes.includes(file.type)) return true;

  // Fallback: check extension for files with missing MIME type
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["mp4", "webm", "mkv", "mov", "avi", "ogv", "m4v", "ts"].includes(ext);
}

/**
 * Check if a file is already an audio file that can be uploaded directly.
 */
export function isAudioFile(file: File): boolean {
  const audioTypes = [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "audio/aac",
    "audio/flac",
    "audio/webm",
    "audio/mp4",
  ];
  if (audioTypes.includes(file.type)) return true;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["mp3", "wav", "ogg", "aac", "flac", "m4a", "wma", "opus"].includes(ext);
}

/**
 * Extract audio from a video file using ffmpeg.wasm.
 *
 * Converts to 128kbps stereo MP3 at 44.1kHz — the sweet spot for
 * mobile streaming quality vs file size.
 *
 * @param videoFile - The video file to extract audio from
 * @param onProgress - Callback for progress updates
 * @returns A Blob containing the MP3 audio data
 * @throws {ExtractionError} If extraction fails
 */
export async function extractAudioFromVideo(
  videoFile: File,
  onProgress?: (p: ExtractionProgress) => void
): Promise<Blob> {
  // ── Guards ──────────────────────────────────────────────────
  const maxSize = getFileSizeLimit();
  const mobile = isMobileHost();
  if (videoFile.size > maxSize) {
    const deviceHint = mobile
      ? " Use a laptop to host full-length movies."
      : " Please extract the audio track using a desktop tool and upload the MP3 directly.";
    throw new ExtractionError(
      `File is too large for browser-based extraction (${formatBytes(videoFile.size)}). ` +
        `Maximum supported size is ${formatBytes(maxSize)}.` +
        deviceHint
    );
  }

  if (videoFile.size < MIN_EXTRACTION_SIZE) {
    throw new ExtractionError(
      "File is too small to contain video with audio. Please upload a valid video file.",
      false
    );
  }

  // ── Load FFmpeg ──────────────────────────────────────────────
  const ffmpeg = await getFFmpeg(onProgress);

  // ── Write input file to WASM filesystem ──────────────────────
  const inputExt = videoFile.name.split(".").pop()?.toLowerCase() ?? "mp4";
  const inputName = `input.${inputExt}`;
  const outputName = "output.mp3";

  onProgress?.({
    phase: "extracting",
    percent: 0,
    message: "Reading video file...",
  });

  try {
    const fileData = await fetchFile(videoFile);
    await ffmpeg.writeFile(inputName, fileData);
  } catch (err) {
    log("Failed to write input file:", err);
    throw new ExtractionError(
      "Not enough memory to process this file. Try a smaller video or use a desktop tool to extract the audio."
    );
  }

  // ── Wire progress ───────────────────────────────────────────
  const progressHandler = ({ progress }: { progress: number; time: number }) => {
    // ffmpeg reports progress as 0..1 (sometimes > 1 due to estimation)
    const pct = Math.min(Math.round(progress * 100), 99);
    onProgress?.({
      phase: "extracting",
      percent: pct,
      message:
        pct < 10
          ? "Analyzing video format..."
          : pct < 90
            ? "Removing video track to save bandwidth..."
            : "Finalizing audio...",
    });
  };
  ffmpeg.on("progress", progressHandler);

  // ── Run extraction ──────────────────────────────────────────
  try {
    const exitCode = await ffmpeg.exec([
      "-i",
      inputName,
      "-vn",           // strip video
      "-ar",
      "44100",         // 44.1kHz sample rate (standard)
      "-ac",
      "2",             // stereo
      "-b:a",
      "128k",          // 128kbps bitrate (quality/size sweet spot)
      "-f",
      "mp3",           // force MP3 container
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new ExtractionError(
        "Audio extraction failed. The video file may be corrupted or use an unsupported codec."
      );
    }
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    log("ffmpeg exec failed:", err);
    throw new ExtractionError(
      "Audio extraction failed unexpectedly. Try a different video file or extract the audio using a desktop tool."
    );
  } finally {
    ffmpeg.off("progress", progressHandler);
  }

  // ── Read output ─────────────────────────────────────────────
  let outputData: Uint8Array;
  try {
    const data = await ffmpeg.readFile(outputName);
    // readFile can return string if encoding is specified, but we didn't specify one
    if (typeof data === "string") {
      throw new Error("Unexpected string output from readFile");
    }
    outputData = data;
  } catch (err) {
    log("Failed to read output:", err);
    throw new ExtractionError(
      "Failed to read extracted audio. The video may not contain an audio track."
    );
  }

  // ── Cleanup WASM filesystem (critical for memory on mobile) ──
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    // Non-fatal: file may already be gone
  }
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    // Non-fatal
  }

  const audioBlob = new Blob([outputData], { type: "audio/mpeg" });

  onProgress?.({
    phase: "done",
    percent: 100,
    message: `Audio extracted (${formatBytes(audioBlob.size)})`,
  });

  log(
    `Extraction complete: ${formatBytes(videoFile.size)} video → ${formatBytes(audioBlob.size)} audio ` +
      `(${Math.round((1 - audioBlob.size / videoFile.size) * 100)}% size reduction)`
  );

  return audioBlob;
}

/**
 * Terminate the ffmpeg instance and free all WASM memory.
 * Call this if you need to reclaim memory after extraction.
 */
export function terminateFFmpeg(): void {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // Already terminated
    }
    ffmpegInstance = null;
    loadPromise = null;
  }
}

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
