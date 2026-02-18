/**
 * Resumable upload to Supabase Storage using the TUS protocol.
 *
 * Supabase Storage supports TUS (https://tus.io) for resumable uploads.
 * This is critical for large video files (100MB+) on unreliable connections —
 * if the upload is interrupted, it can resume from where it left off instead
 * of starting over.
 *
 * Falls back to standard single-request upload if TUS is unavailable.
 */

import { supabase } from "@/integrations/supabase/client";

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log("[TUS]", ...args);
};

/** Default chunk size: 6 MB (Supabase minimum is 5 MB for multipart) */
const DEFAULT_CHUNK_SIZE = 6 * 1024 * 1024;

/** Maximum retries per chunk */
const MAX_CHUNK_RETRIES = 3;

/** Retry delay base (exponential backoff) */
const RETRY_DELAY_MS = 2000;

export interface UploadProgress {
  bytesUploaded: number;
  bytesTotal: number;
  percent: number;
}

export interface ResumableUploadOptions {
  /** Supabase Storage bucket name */
  bucket: string;
  /** Path within the bucket (e.g., "videos/12345.mp4") */
  path: string;
  /** The file to upload */
  file: File;
  /** Content type (defaults to file.type) */
  contentType?: string;
  /** Progress callback */
  onProgress?: (progress: UploadProgress) => void;
  /** Chunk size in bytes (default 6MB) */
  chunkSize?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Upload a file to Supabase Storage using TUS protocol for resumability.
 *
 * The Supabase JS client v2 has built-in TUS support via `uploadToSignedUrl`
 * with `x-upsert`. We use the REST API directly for more control over
 * chunking and progress.
 *
 * @returns The storage path of the uploaded file
 */
export async function resumableUpload(options: ResumableUploadOptions): Promise<string> {
  const {
    bucket,
    path: storagePath,
    file,
    contentType = file.type || "application/octet-stream",
    onProgress,
    chunkSize = DEFAULT_CHUNK_SIZE,
    signal,
  } = options;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase URL or anon key not configured");
  }

  // For files smaller than 2 chunks, use standard upload (simpler, fewer roundtrips)
  if (file.size <= chunkSize * 2) {
    log(`File ${formatBytes(file.size)} < 2 chunks, using standard upload`);
    return standardUpload(bucket, storagePath, file, contentType, onProgress);
  }

  log(`Starting TUS upload: ${formatBytes(file.size)}, chunk size: ${formatBytes(chunkSize)}`);

  // Get auth token for TUS endpoint
  const { data: { session: authSession } } = await supabase.auth.getSession();
  const token = authSession?.access_token || anonKey;

  const tusUrl = `${supabaseUrl}/storage/v1/upload/resumable`;

  // ── Step 1: Create TUS upload ─────────────────────────────────────

  const createResponse = await fetch(tusUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(file.size),
      "Upload-Metadata": [
        `bucketName ${btoa(bucket)}`,
        `objectName ${btoa(storagePath)}`,
        `contentType ${btoa(contentType)}`,
        `cacheControl ${btoa("3600")}`,
      ].join(","),
      "x-upsert": "true",
    },
    signal,
  });

  if (!createResponse.ok) {
    const errText = await createResponse.text().catch(() => "Unknown error");
    log("TUS create failed:", createResponse.status, errText);
    // Fall back to standard upload
    log("Falling back to standard upload");
    return standardUpload(bucket, storagePath, file, contentType, onProgress);
  }

  const uploadUrl = createResponse.headers.get("Location");
  if (!uploadUrl) {
    log("No Location header in TUS response, falling back to standard upload");
    return standardUpload(bucket, storagePath, file, contentType, onProgress);
  }

  log("TUS upload created, URL:", uploadUrl);

  // ── Step 2: Upload chunks ─────────────────────────────────────────

  let offset = 0;
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (signal?.aborted) {
      throw new Error("Upload cancelled");
    }

    const start = offset;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    const chunkBytes = await chunk.arrayBuffer();

    let success = false;
    let retries = 0;

    while (!success && retries < MAX_CHUNK_RETRIES) {
      try {
        const patchResponse = await fetch(uploadUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: chunkBytes,
          signal,
        });

        if (!patchResponse.ok) {
          const errText = await patchResponse.text().catch(() => "");
          throw new Error(`Chunk upload failed: ${patchResponse.status} ${errText}`);
        }

        // Read new offset from response
        const newOffset = patchResponse.headers.get("Upload-Offset");
        if (newOffset) {
          offset = parseInt(newOffset, 10);
        } else {
          offset = end;
        }

        success = true;

        log(`Chunk ${chunkIndex + 1}/${totalChunks} uploaded (offset: ${formatBytes(offset)})`);

        onProgress?.({
          bytesUploaded: offset,
          bytesTotal: file.size,
          percent: Math.round((offset / file.size) * 100),
        });
      } catch (err) {
        retries++;
        if (signal?.aborted) throw new Error("Upload cancelled");

        if (retries >= MAX_CHUNK_RETRIES) {
          log(`Chunk ${chunkIndex + 1} failed after ${MAX_CHUNK_RETRIES} retries:`, err);
          throw err;
        }

        const delay = RETRY_DELAY_MS * Math.pow(2, retries - 1);
        log(`Chunk ${chunkIndex + 1} retry ${retries}/${MAX_CHUNK_RETRIES} in ${delay}ms...`);

        // Before retrying, check current offset on server
        try {
          const headResponse = await fetch(uploadUrl, {
            method: "HEAD",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: anonKey,
              "Tus-Resumable": "1.0.0",
            },
            signal,
          });
          const serverOffset = headResponse.headers.get("Upload-Offset");
          if (serverOffset) {
            offset = parseInt(serverOffset, 10);
            log(`Server offset: ${formatBytes(offset)}`);
          }
        } catch {
          // HEAD failed — retry with current offset
        }

        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  log("TUS upload complete:", storagePath);
  return storagePath;
}

/**
 * Standard (non-resumable) upload fallback.
 * Used for small files or when TUS endpoint is unavailable.
 */
async function standardUpload(
  bucket: string,
  storagePath: string,
  file: File,
  contentType: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<string> {
  onProgress?.({ bytesUploaded: 0, bytesTotal: file.size, percent: 0 });

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  onProgress?.({ bytesUploaded: file.size, bytesTotal: file.size, percent: 100 });
  return storagePath;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
