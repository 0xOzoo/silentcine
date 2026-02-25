import { useEffect, useRef, useCallback } from "react";

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log("[DriftCorrection]", ...args);
};

/**
 * Maximum acceptable drift before triggering a hard seek (seconds).
 * Below this threshold, we use playback rate adjustment.
 */
const HARD_SEEK_THRESHOLD = 2.0;

/**
 * Threshold for micro-drift correction via playback rate (seconds).
 * Below this threshold, no correction is needed.
 */
const DRIFT_TOLERANCE = 0.05; // 50ms

/**
 * The playback rate adjustment factor for gradual correction.
 * 1% faster or slower to gradually converge.
 */
const RATE_ADJUST = 0.01;

/**
 * How often to check drift and correct (ms).
 * Using requestAnimationFrame for smooth correction when tab is focused.
 */
const CHECK_INTERVAL_MS = 500;

interface DriftCorrectionOptions {
  /** The audio/video element to correct */
  audioRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Target time in seconds (from host sync) */
  targetTime: number;
  /** Timestamp of last sync from host (ISO string) */
  lastSyncAt: string | null;
  /** User calibration offset in ms */
  syncOffsetMs: number;
  /** Network latency in ms */
  networkLatencyMs: number;
  /** Whether audio is unlocked and ready */
  enabled: boolean;
}

/**
 * useDriftCorrection provides precise clock drift correction using
 * playback rate adjustment instead of hard seeks for small drifts.
 *
 * For drift < 50ms: no correction
 * For drift 50ms - 2s: adjust playback rate by +/- 1% to gradually converge
 * For drift > 2s: hard seek (immediate correction)
 *
 * This avoids the micro-stutters that come from frequent seeks.
 */
export function useDriftCorrection({
  audioRef,
  isPlaying,
  targetTime,
  lastSyncAt,
  syncOffsetMs,
  networkLatencyMs,
  enabled,
}: DriftCorrectionOptions) {
  const lastCorrectionRef = useRef(0);

  const correctDrift = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying || !enabled) return;

    const now = Date.now();

    // Throttle checks
    if (now - lastCorrectionRef.current < CHECK_INTERVAL_MS) return;
    lastCorrectionRef.current = now;

    // Calculate where playback should be right now
    const syncTimestamp = lastSyncAt ? new Date(lastSyncAt).getTime() : now;
    const timeSinceSync = Math.max(0, (now - syncTimestamp) / 1000);
    const offsetSeconds = syncOffsetMs / 1000;
    const latencyCompensation = networkLatencyMs / 1000;

    const expectedTime = targetTime + timeSinceSync + offsetSeconds + latencyCompensation;
    const actualTime = audio.currentTime;
    const drift = actualTime - expectedTime; // positive = ahead, negative = behind

    const absDrift = Math.abs(drift);

    if (absDrift > HARD_SEEK_THRESHOLD) {
      // Hard seek for large drift (initial sync or seek)
      log(`Hard seek: drift=${drift.toFixed(3)}s, seeking to ${expectedTime.toFixed(2)}s`);
      audio.currentTime = Math.max(0, expectedTime);
      audio.playbackRate = 1.0;
    } else if (absDrift > DRIFT_TOLERANCE) {
      // Gradual rate adjustment for micro-drift
      if (drift > 0) {
        // We're ahead — slow down slightly
        audio.playbackRate = 1.0 - RATE_ADJUST;
      } else {
        // We're behind — speed up slightly
        audio.playbackRate = 1.0 + RATE_ADJUST;
      }
    } else {
      // Within tolerance — normal playback rate
      if (audio.playbackRate !== 1.0) {
        audio.playbackRate = 1.0;
      }
    }
  }, [audioRef, isPlaying, targetTime, lastSyncAt, syncOffsetMs, networkLatencyMs, enabled]);

  // Run drift correction on an interval
  useEffect(() => {
    if (!isPlaying || !enabled) return;

    const interval = setInterval(correctDrift, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [correctDrift, isPlaying, enabled]);

  // Reset playback rate when stopping
  useEffect(() => {
    if (!isPlaying && audioRef.current) {
      audioRef.current.playbackRate = 1.0;
    }
  }, [isPlaying, audioRef]);
}
