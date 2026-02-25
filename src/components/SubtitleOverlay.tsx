import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SubtitleTrack } from "@/hooks/useSession";

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log("[Subtitles]", ...args);
};

interface SubtitleCue {
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

interface SubtitleOverlayProps {
  /** The subtitle track to display, or null for off */
  track: SubtitleTrack | null;
  /** Current playback time in seconds */
  currentTime: number;
  /** Whether playback is active */
  isPlaying: boolean;
}

/**
 * Parse a WebVTT timestamp to seconds.
 * Format: HH:MM:SS.mmm or MM:SS.mmm
 */
function parseVttTimestamp(ts: string): number {
  const parts = ts.trim().split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return parseInt(m, 10) * 60 + parseFloat(s);
  }
  return 0;
}

/**
 * Parse WebVTT content into an array of cues.
 */
function parseVtt(vttContent: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = vttContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  let i = 0;

  // Skip the WEBVTT header and any metadata
  while (i < lines.length && !lines[i].includes("-->")) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for timestamp lines: "00:01:23.456 --> 00:01:25.789"
    if (line.includes("-->")) {
      const [startStr, rest] = line.split("-->");
      // The end timestamp may have position/alignment settings after it
      const endStr = rest.trim().split(/\s+/)[0];

      const start = parseVttTimestamp(startStr);
      const end = parseVttTimestamp(endStr);

      // Collect text lines until empty line or next timestamp
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes("-->")) {
        textLines.push(lines[i].trim());
        i++;
      }

      if (textLines.length > 0 && end > start) {
        // Strip basic HTML tags but keep <i>, <b> for styling
        const text = textLines.join("\n");
        cues.push({ start, end, text });
      }
    } else {
      i++;
    }
  }

  return cues;
}

/**
 * SubtitleOverlay renders the currently active subtitle cue
 * synchronized with playback time.
 *
 * It fetches the VTT file from Supabase Storage (via signed URL),
 * parses it, and displays the matching cue for the current time.
 */
export default function SubtitleOverlay({ track, currentTime, isPlaying }: SubtitleOverlayProps) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [activeCue, setActiveCue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastTrackPathRef = useRef<string | null>(null);

  // Fetch and parse VTT when track changes
  useEffect(() => {
    if (!track?.storagePath) {
      setCues([]);
      setActiveCue(null);
      lastTrackPathRef.current = null;
      return;
    }

    // Skip if same track
    if (lastTrackPathRef.current === track.storagePath) return;
    lastTrackPathRef.current = track.storagePath;

    let cancelled = false;

    const fetchVtt = async () => {
      try {
        log("Fetching subtitle:", track.storagePath);

        // Get a signed URL for the VTT file
        const { data, error: urlErr } = await supabase.storage
          .from("movies")
          .createSignedUrl(track.storagePath!, 3600);

        if (urlErr || !data?.signedUrl) {
          throw new Error(urlErr?.message || "Failed to get subtitle URL");
        }

        const response = await fetch(data.signedUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch subtitle: ${response.status}`);
        }

        const vttContent = await response.text();
        if (cancelled) return;

        const parsedCues = parseVtt(vttContent);
        log(`Parsed ${parsedCues.length} cues from ${track.label}`);

        setCues(parsedCues);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        log("Subtitle fetch error:", msg);
        setError(msg);
        setCues([]);
      }
    };

    fetchVtt();

    return () => {
      cancelled = true;
    };
  }, [track?.storagePath, track?.label]);

  // Find the active cue for the current time
  const findActiveCue = useCallback((time: number): string | null => {
    for (const cue of cues) {
      if (time >= cue.start && time <= cue.end) {
        return cue.text;
      }
    }
    return null;
  }, [cues]);

  // Update active cue on time change
  useEffect(() => {
    if (cues.length === 0) {
      setActiveCue(null);
      return;
    }

    const cueText = findActiveCue(currentTime);
    setActiveCue(cueText);
  }, [currentTime, cues, findActiveCue]);

  // Don't render anything if no track or no active cue
  if (!track || error) return null;
  if (!activeCue) return null;

  return (
    <div className="mb-4 px-4 py-2.5 rounded-lg bg-black/85 text-white text-center backdrop-blur-sm">
      <p
        className="text-sm leading-relaxed whitespace-pre-line"
        dangerouslySetInnerHTML={{
          __html: activeCue
            // Allow basic formatting tags
            .replace(/<(?!\/?(b|i|u|em|strong)\b)[^>]+>/gi, "")
            // Convert newlines to <br>
            .replace(/\n/g, "<br>"),
        }}
      />
    </div>
  );
}
