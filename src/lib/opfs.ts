/**
 * OPFS (Origin Private File System) caching layer for SilentCine.
 *
 * Provides stream-to-disk storage for video and audio files with:
 * - Per-session directories (sessionCode → video.mp4, audio.mp3, meta.json)
 * - LRU eviction when quota is exceeded
 * - Quota management with configurable limits
 * - Blob URL creation for playback from cache
 * - Graceful fallback when OPFS is unavailable (private browsing, old browsers)
 *
 * Directory structure:
 *   /silentcine/
 *     /{sessionCode}/
 *       video.mp4
 *       audio.mp3
 *       meta.json   — { sessionCode, videoSize, audioSize, lastAccessed, createdAt }
 */

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log("[OPFS]", ...args);
};

// ── Types ───────────────────────────────────────────────────────────

export interface CacheMeta {
  sessionCode: string;
  videoSize: number;
  audioSize: number;
  lastAccessed: number; // Unix ms
  createdAt: number;    // Unix ms
  /** Currently cached video quality (e.g., "720p", "1080p") */
  cachedQuality?: string;
}

export interface CacheEntry {
  meta: CacheMeta;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Currently cached quality, if known */
  cachedQuality?: string;
}

export interface QuotaInfo {
  used: number;    // bytes used by SilentCine cache
  available: number; // estimated available storage
  entries: number;   // number of cached sessions
}

// ── Constants ───────────────────────────────────────────────────────

const ROOT_DIR_NAME = "silentcine";
const META_FILE = "meta.json";
const VIDEO_FILE = "video.mp4";
const AUDIO_FILE = "audio.mp3";
const SUBTITLE_PREFIX = "subtitle_";

/**
 * Default max cache size: 2 GB.
 * OPFS typically allows much more, but we self-limit to avoid hogging storage.
 */
const DEFAULT_MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

// ── Feature detection ───────────────────────────────────────────────

let _supported: boolean | null = null;

/**
 * Check if OPFS is available in this browser.
 * Caches the result after first call.
 */
export async function isOpfsSupported(): Promise<boolean> {
  if (_supported !== null) return _supported;

  try {
    if (typeof navigator === "undefined" || !navigator.storage) {
      _supported = false;
      return false;
    }

    // Try to actually get the directory — this fails in some private modes
    const root = await navigator.storage.getDirectory();
    // Quick smoke test: create and delete a temp file
    const testName = `_opfs_test_${Date.now()}`;
    const testHandle = await root.getFileHandle(testName, { create: true });
    // Clean up
    await root.removeEntry(testName);
    void testHandle; // suppress unused warning

    _supported = true;
    log("OPFS is supported");
    return true;
  } catch (e) {
    log("OPFS not available:", e);
    _supported = false;
    return false;
  }
}

// ── Root directory access ───────────────────────────────────────────

async function getRootDir(): Promise<FileSystemDirectoryHandle> {
  const storageRoot = await navigator.storage.getDirectory();
  return storageRoot.getDirectoryHandle(ROOT_DIR_NAME, { create: true });
}

async function getSessionDir(
  sessionCode: string,
  create = false,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await getRootDir();
    return await root.getDirectoryHandle(sessionCode, { create });
  } catch {
    return null;
  }
}

// ── Write operations ────────────────────────────────────────────────

/**
 * Store a video file in the OPFS cache for a session.
 * Streams the file to disk to avoid holding it all in memory.
 *
 * @param sessionCode - The session code (directory name)
 * @param file - The video File or Blob to cache
 * @param onProgress - Optional progress callback (0-100)
 */
export async function cacheVideo(
  sessionCode: string,
  file: File | Blob,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!(await isOpfsSupported())) {
    log("Skipping video cache — OPFS not supported");
    return;
  }

  await ensureQuota(file.size);

  const dir = await getSessionDir(sessionCode, true);
  if (!dir) throw new Error("Failed to create session directory");

  await writeFileStreaming(dir, VIDEO_FILE, file, onProgress);
  await updateMeta(sessionCode, { videoSize: file.size });

  log(`Cached video for session ${sessionCode} (${formatBytes(file.size)})`);
}

/**
 * Store an audio file in the OPFS cache for a session.
 * Downloads from a URL and streams to disk.
 *
 * @param sessionCode - The session code (directory name)
 * @param audioUrl - The URL to download audio from (signed URL or CDN)
 * @param onProgress - Optional progress callback (0-100)
 */
export async function cacheAudioFromUrl(
  sessionCode: string,
  audioUrl: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!(await isOpfsSupported())) {
    log("Skipping audio cache — OPFS not supported");
    return;
  }

  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
  const blob = await downloadWithProgress(response, contentLength, onProgress);

  await ensureQuota(blob.size);

  const dir = await getSessionDir(sessionCode, true);
  if (!dir) throw new Error("Failed to create session directory");

  await writeFileStreaming(dir, AUDIO_FILE, blob);
  await updateMeta(sessionCode, { audioSize: blob.size });

  log(`Cached audio for session ${sessionCode} (${formatBytes(blob.size)})`);
}

/**
 * Store an audio Blob directly (for when we already have it in memory).
 */
export async function cacheAudioBlob(
  sessionCode: string,
  blob: Blob,
): Promise<void> {
  if (!(await isOpfsSupported())) return;

  await ensureQuota(blob.size);

  const dir = await getSessionDir(sessionCode, true);
  if (!dir) throw new Error("Failed to create session directory");

  await writeFileStreaming(dir, AUDIO_FILE, blob);
  await updateMeta(sessionCode, { audioSize: blob.size });

  log(`Cached audio blob for session ${sessionCode} (${formatBytes(blob.size)})`);
}

// ── Read operations ─────────────────────────────────────────────────

/**
 * Get a Blob URL for the cached video, or null if not cached.
 * Updates lastAccessed timestamp for LRU.
 */
export async function getCachedVideoUrl(sessionCode: string): Promise<string | null> {
  return getCachedFileUrl(sessionCode, VIDEO_FILE);
}

/**
 * Get a Blob URL for the cached audio, or null if not cached.
 * Updates lastAccessed timestamp for LRU.
 */
export async function getCachedAudioUrl(sessionCode: string): Promise<string | null> {
  return getCachedFileUrl(sessionCode, AUDIO_FILE);
}

/**
 * Check what's cached for a given session.
 */
export async function getCacheEntry(sessionCode: string): Promise<CacheEntry | null> {
  if (!(await isOpfsSupported())) return null;

  const dir = await getSessionDir(sessionCode);
  if (!dir) return null;

  const meta = await readMeta(sessionCode);
  if (!meta) return null;

  const hasVideo = await fileExists(dir, VIDEO_FILE);
  const hasAudio = await fileExists(dir, AUDIO_FILE);

  return { meta, hasVideo, hasAudio, cachedQuality: meta.cachedQuality };
}

// ── Delete operations ───────────────────────────────────────────────

/**
 * Delete all cached files for a session.
 */
export async function deleteSession(sessionCode: string): Promise<void> {
  if (!(await isOpfsSupported())) return;

  try {
    const root = await getRootDir();
    await root.removeEntry(sessionCode, { recursive: true });
    log(`Deleted cache for session ${sessionCode}`);
  } catch {
    // Directory might not exist — that's fine
  }
}

/**
 * Clear the entire SilentCine OPFS cache.
 */
export async function clearCache(): Promise<void> {
  if (!(await isOpfsSupported())) return;

  try {
    const storageRoot = await navigator.storage.getDirectory();
    await storageRoot.removeEntry(ROOT_DIR_NAME, { recursive: true });
    log("Cleared entire cache");
  } catch {
    // Root might not exist
  }
}

// ── Quota management ────────────────────────────────────────────────

/**
 * Get current quota usage information.
 */
export async function getQuotaInfo(): Promise<QuotaInfo> {
  if (!(await isOpfsSupported())) {
    return { used: 0, available: 0, entries: 0 };
  }

  let used = 0;
  let entries = 0;

  try {
    const root = await getRootDir();

    for await (const [name, handle] of root as any) {
      if (handle.kind !== "directory") continue;

      entries++;
      const meta = await readMeta(name);
      if (meta) {
        used += meta.videoSize + meta.audioSize;
      }
    }
  } catch {
    // Best effort
  }

  // Estimate available via StorageManager
  let available = DEFAULT_MAX_CACHE_BYTES - used;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0;
      const totalUsage = estimate.usage || 0;
      available = Math.min(
        DEFAULT_MAX_CACHE_BYTES - used,
        quota - totalUsage,
      );
    }
  } catch {
    // StorageManager not available
  }

  return { used, available: Math.max(0, available), entries };
}

/**
 * Ensure there's enough room for a new file by evicting oldest sessions.
 * Uses LRU: oldest lastAccessed gets evicted first.
 */
async function ensureQuota(neededBytes: number): Promise<void> {
  const info = await getQuotaInfo();

  if (info.available >= neededBytes) return;

  log(`Need ${formatBytes(neededBytes)}, only ${formatBytes(info.available)} available. Evicting...`);

  // Collect all entries sorted by lastAccessed (oldest first)
  const entries: CacheMeta[] = [];
  try {
    const root = await getRootDir();
    for await (const [name, handle] of root as any) {
      if (handle.kind !== "directory") continue;
      const meta = await readMeta(name);
      if (meta) entries.push(meta);
    }
  } catch {
    return;
  }

  entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

  let freed = 0;
  const targetFree = neededBytes - info.available;

  for (const entry of entries) {
    if (freed >= targetFree) break;

    const entrySize = entry.videoSize + entry.audioSize;
    await deleteSession(entry.sessionCode);
    freed += entrySize;
    log(`Evicted session ${entry.sessionCode} (freed ${formatBytes(entrySize)})`);
  }

  if (freed < targetFree) {
    log(`Warning: Could only free ${formatBytes(freed)} of ${formatBytes(targetFree)} needed`);
  }
}

// ── Internal helpers ────────────────────────────────────────────────

async function getCachedFileUrl(sessionCode: string, fileName: string): Promise<string | null> {
  if (!(await isOpfsSupported())) return null;

  const dir = await getSessionDir(sessionCode);
  if (!dir) return null;

  try {
    const fileHandle = await dir.getFileHandle(fileName);
    const file = await fileHandle.getFile();

    if (file.size === 0) return null;

    // Touch lastAccessed for LRU
    await updateMeta(sessionCode, {});

    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

async function writeFileStreaming(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  data: File | Blob,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(fileName, { create: true });

  // Use createWritable for streaming writes (no full-copy in memory)
  const writable = await fileHandle.createWritable();

  if (onProgress && data.size > 0) {
    // Stream in chunks for progress reporting
    const CHUNK_SIZE = 1024 * 1024; // 1 MB chunks
    const totalChunks = Math.ceil(data.size / CHUNK_SIZE);
    let written = 0;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, data.size);
      const chunk = data.slice(start, end);
      await writable.write(chunk);
      written += end - start;
      onProgress(Math.round((written / data.size) * 100));
    }
  } else {
    // Single write for small files or when no progress needed
    await writable.write(data);
  }

  await writable.close();
}

async function downloadWithProgress(
  response: Response,
  contentLength: number,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  if (!response.body || !onProgress || contentLength === 0) {
    // Fallback: read entire response as blob
    return response.blob();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.length;

    if (contentLength > 0) {
      onProgress(Math.round((received / contentLength) * 100));
    }
  }

  return new Blob(chunks);
}

async function fileExists(
  dir: FileSystemDirectoryHandle,
  fileName: string,
): Promise<boolean> {
  try {
    const handle = await dir.getFileHandle(fileName);
    const file = await handle.getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

// ── Meta file management ────────────────────────────────────────────

async function readMeta(sessionCode: string): Promise<CacheMeta | null> {
  const dir = await getSessionDir(sessionCode);
  if (!dir) return null;

  try {
    const handle = await dir.getFileHandle(META_FILE);
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text) as CacheMeta;
  } catch {
    return null;
  }
}

async function updateMeta(
  sessionCode: string,
  partial: Partial<Omit<CacheMeta, "sessionCode">>,
): Promise<void> {
  const dir = await getSessionDir(sessionCode, true);
  if (!dir) return;

  const existing = await readMeta(sessionCode);
  const now = Date.now();

  const meta: CacheMeta = {
    sessionCode,
    videoSize: partial.videoSize ?? existing?.videoSize ?? 0,
    audioSize: partial.audioSize ?? existing?.audioSize ?? 0,
    lastAccessed: now,
    createdAt: existing?.createdAt ?? now,
    cachedQuality: partial.cachedQuality ?? existing?.cachedQuality,
  };

  const handle = await dir.getFileHandle(META_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

// ── Subtitle caching ────────────────────────────────────────────────

/**
 * Cache a subtitle VTT file in OPFS for a session.
 *
 * @param sessionCode - Session code (directory name)
 * @param trackIndex - Subtitle track index (used as filename suffix)
 * @param vttContent - The WebVTT content string
 */
export async function cacheSubtitle(
  sessionCode: string,
  trackIndex: number,
  vttContent: string,
): Promise<void> {
  if (!(await isOpfsSupported())) return;

  const dir = await getSessionDir(sessionCode, true);
  if (!dir) return;

  const fileName = `${SUBTITLE_PREFIX}${trackIndex}.vtt`;
  const blob = new Blob([vttContent], { type: "text/vtt" });
  await writeFileStreaming(dir, fileName, blob);
  log(`Cached subtitle track ${trackIndex} for session ${sessionCode}`);
}

/**
 * Get cached subtitle content for a session track, or null if not cached.
 */
export async function getCachedSubtitle(
  sessionCode: string,
  trackIndex: number,
): Promise<string | null> {
  if (!(await isOpfsSupported())) return null;

  const dir = await getSessionDir(sessionCode);
  if (!dir) return null;

  try {
    const fileName = `${SUBTITLE_PREFIX}${trackIndex}.vtt`;
    const fileHandle = await dir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    if (file.size === 0) return null;
    return await file.text();
  } catch {
    return null;
  }
}

// ── Quality-aware caching ───────────────────────────────────────────

/**
 * Cache a video variant for a specific quality level.
 * Evicts any previously cached quality for this session first
 * (only one quality is cached at a time to save disk space).
 *
 * @param sessionCode - Session code (directory name)
 * @param quality - Quality label (e.g., "720p", "1080p")
 * @param videoUrl - URL to download the video variant from
 * @param onProgress - Optional progress callback (0-100)
 */
export async function cacheQuality(
  sessionCode: string,
  quality: string,
  videoUrl: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!(await isOpfsSupported())) {
    log("Skipping quality cache — OPFS not supported");
    return;
  }

  // Check if this quality is already cached
  const existing = await getCacheEntry(sessionCode);
  if (existing?.cachedQuality === quality && existing.hasVideo) {
    log(`Quality ${quality} already cached for session ${sessionCode}`);
    return;
  }

  // Evict the old video (different quality)
  if (existing?.hasVideo) {
    log(`Evicting old quality (${existing.cachedQuality}) for session ${sessionCode}`);
    const dir = await getSessionDir(sessionCode);
    if (dir) {
      try {
        await dir.removeEntry(VIDEO_FILE);
      } catch {
        // File might not exist
      }
    }
  }

  // Download and cache the new quality
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${quality} variant: ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
  const blob = await downloadWithProgress(response, contentLength, onProgress);

  await ensureQuota(blob.size);

  const dir = await getSessionDir(sessionCode, true);
  if (!dir) throw new Error("Failed to create session directory");

  await writeFileStreaming(dir, VIDEO_FILE, blob);
  await updateMeta(sessionCode, { videoSize: blob.size, cachedQuality: quality });

  log(`Cached ${quality} variant for session ${sessionCode} (${formatBytes(blob.size)})`);
}

/**
 * Get the currently cached quality for a session, or null if nothing cached.
 */
export async function getCachedQuality(sessionCode: string): Promise<string | null> {
  const entry = await getCacheEntry(sessionCode);
  if (entry?.hasVideo && entry.cachedQuality) {
    return entry.cachedQuality;
  }
  return null;
}

// ── Utility ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
