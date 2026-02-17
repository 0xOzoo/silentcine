import { supabase } from "@/integrations/supabase/client";

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log("[AudioExtract]", ...args);
};

/** Maximum video file size (500MB — server memory constraint). */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/** Minimum file size to bother extracting */
const MIN_FILE_SIZE = 1024;

/** How often to poll the movies table for extraction status (ms) */
const POLL_INTERVAL_MS = 3000;

/** Maximum time to wait for extraction before timing out (ms) */
const EXTRACTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface ExtractionProgress {
  /** Current phase of the pipeline */
  phase: "uploading" | "processing" | "done";
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

/** Movie record from the database */
export interface MovieRecord {
  id: string;
  title: string;
  status: "uploaded" | "processing" | "ready" | "error";
  video_path: string;
  audio_path: string | null;
  processing_error: string | null;
  created_at: string;
}

/**
 * Detect if the host is running on a mobile device.
 * Uses a combination of user agent, pointer capability, and viewport width.
 */
export function isMobileHost(): boolean {
  const ua = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
  const coarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrowViewport = typeof window !== "undefined" && window.innerWidth < 1024;
  return [ua, coarsePointer, narrowViewport].filter(Boolean).length >= 2;
}

/**
 * Get the file size limit. Server handles extraction so the limit is
 * about upload size, not browser WASM memory.
 */
export function getFileSizeLimit(): number {
  return MAX_FILE_SIZE;
}

/**
 * Extract audio from a video file via server worker.
 *
 * Flow:
 * 1. Upload video to Supabase Storage (movies bucket)
 * 2. Insert a record in the movies table
 * 3. POST to server /extract endpoint to trigger extraction
 * 4. Poll movies table until status is 'ready' or 'error'
 * 5. Return signed URL for the extracted audio
 *
 * @param videoFile - The video file to extract audio from
 * @param onProgress - Callback for progress updates
 * @returns The signed URL for the extracted audio file
 * @throws {ExtractionError} If extraction fails at any stage
 */
export async function extractAudioFromVideo(
  videoFile: File,
  onProgress?: (p: ExtractionProgress) => void,
): Promise<string> {
  // ── Guards ──────────────────────────────────────────────────
  if (videoFile.size > MAX_FILE_SIZE) {
    throw new ExtractionError(
      `File is too large (${formatBytes(videoFile.size)}). Maximum is ${formatBytes(MAX_FILE_SIZE)}.`,
    );
  }
  if (videoFile.size < MIN_FILE_SIZE) {
    throw new ExtractionError(
      "File is too small to contain video with audio.",
      false,
    );
  }

  const piUrl = import.meta.env.VITE_PI_WORKER_URL;
  if (!piUrl) {
    throw new ExtractionError(
      "Server worker URL not configured. Set VITE_PI_WORKER_URL in .env.",
      false,
    );
  }

  const emit = (phase: ExtractionProgress["phase"], percent: number, message: string) => {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    onProgress?.({ phase, percent: isNaN(clamped) ? 0 : clamped, message });
  };

  try {
    // ── 1. Upload video to Supabase Storage ─────────────────────
    emit("uploading", 0, "Uploading video to storage...");

    const fileExt = videoFile.name.split(".").pop()?.toLowerCase() ?? "mp4";
    const fileName = `${Date.now()}.${fileExt}`;
    const videoPath = `videos/${fileName}`;

    const { error: storageError } = await supabase.storage
      .from("movies")
      .upload(videoPath, videoFile, {
        cacheControl: "3600",
        upsert: false,
      });

    if (storageError) {
      log("Storage upload failed:", storageError);
      throw new ExtractionError(
        `Failed to upload video: ${storageError.message}`,
      );
    }

    emit("uploading", 50, "Video uploaded, creating record...");

    // ── 2. Insert movies table record ───────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: movie, error: dbError } = await (supabase as any)
      .from("movies")
      .insert({
        title: videoFile.name,
        video_path: videoPath,
        status: "uploaded",
      })
      .select()
      .single();

    if (dbError || !movie) {
      log("DB insert failed:", dbError);
      throw new ExtractionError(
        `Failed to create movie record: ${dbError?.message ?? "Unknown error"}`,
      );
    }

    const movieId = (movie as MovieRecord).id;
    emit("uploading", 80, "Sending to server for extraction...");

    // ── 3. Trigger server extraction ──────────────────────────
    let piResponse: Response;
    try {
      piResponse = await fetch(`${piUrl}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movieId,
          videoPath,
        }),
      });
    } catch (err) {
      log("Pi worker network error:", err);
      throw new ExtractionError(
        "Cannot reach extraction server. Make sure it's running and accessible on your network.",
        true,
      );
    }

    if (!piResponse.ok) {
      const errText = await piResponse.text().catch(() => "Unknown error");
      log("Pi worker error:", piResponse.status, errText);
      throw new ExtractionError(
        `Server extraction error: ${errText}`,
        true,
      );
    }

    emit("processing", 0, "Server is extracting audio...");

    // ── 4. Poll for extraction result ───────────────────────────
    const audioUrl = await pollForResult(movieId, emit);

    emit("done", 100, "Audio extraction complete!");
    log("Extraction complete, audio URL:", audioUrl);

    return audioUrl;
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    log("Extraction error:", msg);
    throw new ExtractionError(`Extraction failed: ${msg}`, true);
  }
}

/**
 * Poll the movies table until extraction is complete or fails.
 * Returns the signed audio URL on success.
 */
async function pollForResult(
  movieId: string,
  emit: (phase: ExtractionProgress["phase"], percent: number, message: string) => void,
): Promise<string> {
  const startTime = Date.now();
  let lastStatus = "processing";

  while (true) {
    // Timeout guard
    if (Date.now() - startTime > EXTRACTION_TIMEOUT_MS) {
      throw new ExtractionError(
        "Audio extraction timed out. The video may be too long or the server may be overloaded.",
        true,
      );
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("movies")
      .select("*")
      .eq("id", movieId)
      .single();

    if (error) {
      log("Poll error:", error);
      continue; // Retry on transient errors
    }

    const movie = data as unknown as MovieRecord;

    if (movie.status !== lastStatus) {
      lastStatus = movie.status;
      log("Status changed to:", movie.status);
    }

    if (movie.status === "processing") {
      // Animate an indeterminate progress
      const elapsed = Date.now() - startTime;
      const fakePercent = Math.min(90, Math.floor(elapsed / 1000)); // ~1% per second, cap at 90
      emit("processing", fakePercent, "Server is extracting audio...");
      continue;
    }

    if (movie.status === "error") {
      throw new ExtractionError(
        movie.processing_error || "Audio extraction failed on server.",
        true,
      );
    }

    if (movie.status === "ready" && movie.audio_path) {
      // Get a signed URL for the extracted audio (1 hour expiry)
      const { data: urlData, error: urlError } = await supabase.storage
        .from("movies")
        .createSignedUrl(movie.audio_path, 3600);

      if (urlError || !urlData?.signedUrl) {
        throw new ExtractionError(
          "Audio was extracted but failed to generate download URL.",
          true,
        );
      }

      return urlData.signedUrl;
    }
  }
}

/**
 * No-op — kept for API compatibility with HostSession cleanup.
 * The old ffmpeg.wasm termination is no longer needed since extraction
 * happens on the server, not in the browser.
 */
export function terminateFFmpeg(): void {
  // No-op: nothing to terminate
}

/**
 * Check if a file is a video type that needs audio extraction.
 */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|avi|mkv|webm|ogv|m4v|ts|mpeg|mpg)$/i.test(file.name);
}

/**
 * Check if a file is already an audio file that can be uploaded directly.
 */
export function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|aac|ogg|m4a|flac|wma|opus)$/i.test(file.name);
}

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
