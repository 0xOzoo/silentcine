import { useState, useCallback } from "react";
import { Upload, Languages, Check, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SubtitleUploaderProps {
  /** Movie ID to attach the subtitle to */
  movieId: string | null;
  /** Callback after successful upload with the new track info */
  onUploaded?: (track: { label: string; language: string; storagePath: string }) => void;
}

/**
 * SubtitleUploader allows the host to upload external subtitle files
 * (SRT, VTT, ASS) which get converted to WebVTT by the worker.
 */
export default function SubtitleUploader({ movieId, onUploaded }: SubtitleUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !movieId) return;

    // Reset the input so the same file can be re-uploaded
    e.target.value = "";

    const workerUrl = import.meta.env.VITE_WORKER_URL;
    const workerSecret = import.meta.env.VITE_WORKER_SECRET;

    if (!workerUrl) {
      setError("Worker URL not configured");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("movieId", movieId);

      // Try to guess language from filename (e.g., "movie.en.srt" or "movie_english.srt")
      const name = file.name.toLowerCase();
      const langMatch = name.match(/[._-](en|fr|es|de|it|pt|nl|ru|ja|ko|zh|ar|hi|tr|pl|sv|da|no|fi|cs|hu|ro|bg|el|he|th|vi|id|ms|uk|hr|sk|sl|sr|lt|lv|et|ga|mt|sq|mk|bs|is|ka|hy|az|kk|uz|tg|ky|mn|lo|km|my|si|am|ne|bn|ta|te|kn|ml|mr|gu|pa|or|as)\b/);
      if (langMatch) {
        formData.append("language", langMatch[1]);
      }

      // Derive label from filename
      const baseName = file.name.replace(/\.[^.]+$/, "");
      formData.append("label", baseName);

      const response = await fetch(`${workerUrl}/upload-subtitle`, {
        method: "POST",
        headers: {
          ...(workerSecret ? { "x-api-key": workerSecret } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(errData.error || `Upload failed: ${response.status}`);
      }

      const { track } = await response.json();

      setUploadedCount((c) => c + 1);
      toast.success(`Subtitle "${track.label}" uploaded successfully`);

      onUploaded?.({
        label: track.label,
        language: track.language || "unknown",
        storagePath: track.storagePath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Subtitle upload failed: ${msg}`);
    } finally {
      setIsUploading(false);
    }
  }, [movieId, onUploaded]);

  return (
    <div className="flex flex-col items-center gap-2">
      <label className="cursor-pointer">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={isUploading || !movieId}
          asChild
        >
          <span>
            {isUploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : uploadedCount > 0 ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Languages className="w-3.5 h-3.5" />
            )}
            {isUploading
              ? "Uploading..."
              : uploadedCount > 0
                ? `${uploadedCount} subtitle${uploadedCount > 1 ? "s" : ""} added`
                : "Add Subtitles"}
          </span>
        </Button>
        <input
          type="file"
          accept=".srt,.vtt,.ass,.ssa,.sub"
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploading || !movieId}
        />
      </label>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
