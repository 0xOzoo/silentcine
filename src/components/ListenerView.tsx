import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Play, Volume2, VolumeX, Headphones, ScanLine, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useListenerSession, AudioTrack, SubtitleTrack } from "@/hooks/useSession";
import SyncCalibration from "./SyncCalibration";
import TrackSelector from "./TrackSelector";
import QRScanner from "./QRScanner";

const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => { if (DEBUG) console.log('[SilentCine]', ...args); };

interface ListenerViewProps {
  onBack: () => void;
  sessionId?: string;
}

const ListenerView = ({ onBack, sessionId }: ListenerViewProps) => {
  const [inputCode, setInputCode] = useState(sessionId || "");
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [localIsPlaying, setLocalIsPlaying] = useState(false);
  const [syncOffset, setSyncOffset] = useState(0);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(0);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState(-1);
  const [currentSubtitle, setCurrentSubtitle] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [shouldAutoConnect, setShouldAutoConnect] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(!IS_MOBILE);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLVideoElement>(null);
  const lastSyncRef = useRef<string | null>(null);
  const sessionRef = useRef(sessionId || "");

  const { session, isConnected, isLoading, networkLatencyMs, syncIntervalMs, setSyncIntervalMs, connect } = useListenerSession(inputCode);

  // Keep ref in sync for cleanup effect
  useEffect(() => {
    sessionRef.current = inputCode;
  }, [inputCode]);

  const handleConnect = async () => {
    if (inputCode.length > 0) {
      await connect();
    }
  };

  // Auto-connect after QR scan sets the code
  useEffect(() => {
    if (shouldAutoConnect && inputCode.length > 0 && !isLoading && !isConnected) {
      setShouldAutoConnect(false);
      connect();
    }
  }, [shouldAutoConnect, inputCode, isLoading, isConnected, connect]);

  const handleQRScan = (code: string) => {
    setInputCode(code);
    setShouldAutoConnect(true);
  };

  // Unlock AudioContext on mobile via user gesture
  const unlockAudio = useCallback(async () => {
    try {
      const audio = audioRef.current;
      if (audio) {
        // Play and immediately pause a silent moment to unlock the AudioContext
        audio.muted = true;
        audio.volume = 0;
        await audio.play();
        audio.pause();
        audio.muted = isMuted;
        audio.volume = isMuted ? 0 : volume / 100;
        audio.currentTime = 0;
      }

      // Also unlock a raw AudioContext (some browsers need this separately)
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        // Resume if suspended
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        // Clean up after a short delay
        setTimeout(() => ctx.close().catch(() => {}), 100);
      }

      setAudioUnlocked(true);
      setAudioError(null);
      log('Audio unlocked successfully');
    } catch (err) {
      log('Audio unlock failed:', err);
      setAudioError('Audio permission denied. Please allow audio and try again.');
    }
  }, [isMuted, volume]);

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
  };

  // Handle volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume / 100;
    }
  }, [volume, isMuted]);

  // Handle audio track change
  const handleAudioTrackChange = (index: number) => {
    setSelectedAudioTrack(index);
  };

  // Handle subtitle track change
  const handleSubtitleTrackChange = (index: number) => {
    setSelectedSubtitleTrack(index);
    if (index === -1) {
      setCurrentSubtitle(null);
    }
  };

  // Sync playback with host (with calibration offset and latency compensation)
  useEffect(() => {
    if (!session || !audioRef.current || !session.audio_url) return;
    // Don't attempt playback until audio is unlocked on mobile
    if (!audioUnlocked) return;

    const audio = audioRef.current;

    // Sync on every poll update (not just when last_sync_at changes)
    // This ensures continuous drift correction even when host keeps playing
    const targetTimeSeconds = session.current_time_ms / 1000;

    // Calculate time elapsed since the host last synced state
    const syncTimestamp = session.last_sync_at ? new Date(session.last_sync_at).getTime() : Date.now();
    const timeSinceSync = Math.max(0, (Date.now() - syncTimestamp) / 1000);
    
    // Apply user calibration offset and network latency compensation
    const offsetSeconds = syncOffset / 1000;
    const latencyCompensation = networkLatencyMs / 1000;

    // If playing, extrapolate where playback should be now
    // Add latency compensation to account for network delay
    const compensatedTime = session.is_playing
      ? targetTimeSeconds + timeSinceSync + offsetSeconds + latencyCompensation
      : targetTimeSeconds + offsetSeconds;

    // Drift threshold: only seek if >0.5s off (avoids micro-stutters)
    const currentDiff = Math.abs(audio.currentTime - compensatedTime);
    if (currentDiff > 0.5) {
      log(`Sync correction: drift=${currentDiff.toFixed(2)}s, latency=${networkLatencyMs}ms, seeking to ${compensatedTime.toFixed(2)}s`);
      audio.currentTime = Math.max(0, compensatedTime);
    }

    // Handle play/pause state transitions
    if (session.is_playing && audio.paused) {
      audio.play()
        .then(() => {
          setLocalIsPlaying(true);
          log('Playback started via sync');
        })
        .catch(err => {
          log('Play blocked by browser:', err);
          // If play fails on mobile, reset unlock state so overlay re-appears
          if (IS_MOBILE) {
            setAudioUnlocked(false);
            setAudioError('Tap "Enable Audio" to resume playback');
          }
        });
    } else if (!session.is_playing && !audio.paused) {
      audio.pause();
      setLocalIsPlaying(false);
      log('Playback paused via sync');
    }
  }, [session, syncOffset, audioUnlocked, networkLatencyMs]);

  // Get available tracks from session
  const audioTracks: AudioTrack[] = session?.audio_tracks || [];
  const subtitleTracks: SubtitleTrack[] = session?.subtitle_tracks || [];

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="min-h-screen py-10 px-4"
    >
      <div className="container max-w-md mx-auto">
        {/* Header */}
        <Button variant="ghost" onClick={onBack} className="mb-8">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        {!isConnected ? (
          /* Connect View */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="cinema-card rounded-3xl p-8 border border-border text-center"
          >
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Headphones className="w-10 h-10 text-primary" />
            </div>

            <h2 className="font-display text-2xl font-bold text-foreground mb-2">
              Join a Session
            </h2>
            <p className="text-muted-foreground text-sm mb-8">
              Enter the session code or scan the QR code at your venue
            </p>

            <div className="space-y-4">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="Enter session code"
                className="w-full h-14 px-6 rounded-xl bg-secondary border border-border text-center text-2xl font-display font-bold tracking-widest text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                maxLength={8}
              />

              {isLoading ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex flex-col items-center gap-3">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-12 h-12 rounded-full border-3 border-primary/20 border-t-primary"
                    />
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm text-muted-foreground"
                    >
                      Connecting to session...
                    </motion.p>
                  </div>
                  <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary to-glow-secondary rounded-full"
                      initial={{ x: "-100%" }}
                      animate={{ x: "100%" }}
                      transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </div>
                </motion.div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    size="xl"
                    onClick={() => setIsScannerOpen(true)}
                  >
                    <ScanLine className="w-5 h-5 mr-2" />
                    Scan QR
                  </Button>
                  
                  <Button
                    variant="hero"
                    size="xl"
                    onClick={handleConnect}
                    disabled={inputCode.length === 0}
                  >
                    Connect
                  </Button>
                </div>
              )}
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              Make sure your volume is turned up and headphones are connected
            </p>

            {/* QR Scanner Modal */}
            <QRScanner
              isOpen={isScannerOpen}
              onClose={() => setIsScannerOpen(false)}
              onScan={handleQRScan}
            />
          </motion.div>
        ) : (
          /* Player View */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="cinema-card rounded-3xl p-8 border border-border"
          >
            {/* Mobile Audio Unlock Overlay */}
            <AnimatePresence>
              {isConnected && !audioUnlocked && session?.audio_url && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                >
                  <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    className="bg-card border border-border rounded-3xl p-8 max-w-sm w-full text-center"
                  >
                    <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Headphones className="w-10 h-10 text-primary" />
                    </div>
                    <h3 className="font-display text-xl font-bold text-foreground mb-2">
                      Enable Audio
                    </h3>
                    <p className="text-muted-foreground text-sm mb-6">
                      Your browser requires a tap to start audio playback.
                      Make sure your headphones are connected.
                    </p>
                    {audioError && (
                      <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-destructive/10 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {audioError}
                      </div>
                    )}
                    <Button
                      variant="hero"
                      size="xl"
                      className="w-full"
                      onClick={unlockAudio}
                    >
                      <Play className="w-5 h-5 mr-2" />
                      Tap to Enable Audio
                    </Button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Session Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
                Connected
              </div>
              <h2 className="font-display text-xl font-bold text-foreground">
                Session: {session?.code}
              </h2>
              {session?.audio_filename && (
                <p className="text-muted-foreground text-sm mt-1">
                  {session.audio_filename}
                </p>
              )}
            </div>

            {/* Hidden Video Element for Audio Playback */}
            {session?.audio_url && (
              <video
                ref={audioRef}
                src={session.audio_url}
                preload="auto"
                playsInline
                style={{ display: 'none' }}
                onError={(e) => {
                  const target = e.currentTarget;
                  log('Audio load error:', target.error?.message, 'code:', target.error?.code);
                  setAudioError(`Failed to load audio: ${target.error?.message || 'Unknown error'}`);
                }}
                onCanPlay={() => {
                  log('Audio ready to play');
                  setAudioError(null);
                }}
              />
            )}

            {/* Current Subtitle Display */}
            {currentSubtitle && (
              <div className="mb-4 p-3 rounded-lg bg-black/80 text-white text-center text-sm">
                {currentSubtitle}
              </div>
            )}

            {/* Now Playing */}
            <div className="text-center py-8">
              <motion.div
                animate={{
                  scale: localIsPlaying ? [1, 1.05, 1] : 1,
                }}
                transition={{
                  duration: 2,
                  repeat: localIsPlaying ? Infinity : 0,
                  ease: "easeInOut",
                }}
                className="w-32 h-32 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/20 to-glow-secondary/20 flex items-center justify-center border border-primary/30 cinema-glow"
              >
                {localIsPlaying ? (
                  <div className="flex items-end gap-1 h-8">
                    {[1, 2, 3, 4, 5].map((bar) => (
                      <motion.div
                        key={bar}
                        className="w-1.5 bg-primary rounded-full"
                        animate={{
                          height: ["20%", "100%", "40%", "80%", "20%"],
                        }}
                        transition={{
                          duration: 0.8,
                          repeat: Infinity,
                          delay: bar * 0.1,
                        }}
                      />
                    ))}
                  </div>
                ) : !session?.audio_url ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-12 h-12 rounded-full border-2 border-primary/30 border-t-primary"
                  />
                ) : (
                  <Headphones className="w-12 h-12 text-primary/50" />
                )}
              </motion.div>

              <p className="text-muted-foreground text-sm">
                {!session?.audio_url 
                  ? "Waiting for host to upload video..." 
                  : !audioUnlocked
                    ? "Tap to enable audio..."
                  : localIsPlaying 
                    ? "Audio streaming..." 
                    : session?.is_playing 
                      ? "Syncing with host..." 
                      : "Waiting for host to start playback..."}
              </p>
              
              {/* Audio error display */}
              {audioError && audioUnlocked && (
                <div className="flex items-center justify-center gap-2 mt-2 text-xs text-destructive">
                  <AlertCircle className="w-3 h-3" />
                  {audioError}
                </div>
              )}
            </div>

            {/* Mute Button */}
            <div className="flex justify-center mb-8">
              <button
                onClick={toggleMute}
                disabled={!session?.audio_url || !audioUnlocked}
                className="w-20 h-20 rounded-full bg-gradient-to-r from-primary to-glow-secondary flex items-center justify-center shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMuted ? (
                  <VolumeX className="w-8 h-8 text-primary-foreground" />
                ) : (
                  <Volume2 className="w-8 h-8 text-primary-foreground" />
                )}
              </button>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-4 mb-6">
              <button
                onClick={toggleMute}
                className="p-2 rounded-lg hover:bg-secondary transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <Volume2 className="w-5 h-5 text-foreground" />
                )}
              </button>
              <Slider
                value={[isMuted ? 0 : volume]}
                onValueChange={(val) => {
                  setVolume(val[0]);
                  if (val[0] > 0) setIsMuted(false);
                }}
                max={100}
                step={1}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-8 text-right">
                {isMuted ? 0 : volume}%
              </span>
            </div>

            {/* Track Selection & Sync Controls */}
            <div className="flex gap-2 justify-center mb-6">
              <TrackSelector
                audioTracks={audioTracks}
                subtitleTracks={subtitleTracks}
                selectedAudioTrack={selectedAudioTrack}
                selectedSubtitleTrack={selectedSubtitleTrack}
                onAudioTrackChange={handleAudioTrackChange}
                onSubtitleTrackChange={handleSubtitleTrackChange}
              />
              <SyncCalibration
                offsetMs={syncOffset}
                onOffsetChange={setSyncOffset}
              />
            </div>

            {/* Sync Status Indicator */}
            {audioUnlocked && session?.audio_url && (
              <div className="flex flex-col items-center gap-2 mb-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                    networkLatencyMs < 100 ? 'bg-green-500/10 text-green-500' :
                    networkLatencyMs < 300 ? 'bg-yellow-500/10 text-yellow-500' :
                    'bg-red-500/10 text-red-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      networkLatencyMs < 100 ? 'bg-green-500' :
                      networkLatencyMs < 300 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`} />
                    {networkLatencyMs}ms
                  </span>
                  {syncOffset !== 0 && (
                    <span className="text-muted-foreground/70">
                      offset: {syncOffset > 0 ? '+' : ''}{syncOffset}ms
                    </span>
                  )}
                </div>
                {/* Sync speed toggle: 1s outdoor / 2s indoor */}
                <button
                  onClick={() => setSyncIntervalMs(syncIntervalMs <= 1000 ? 2000 : 1000)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
                    syncIntervalMs <= 1000
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  {syncIntervalMs <= 1000 ? 'Outdoor mode (1s sync)' : 'Indoor mode (2s sync)'}
                </button>
              </div>
            )}

            {/* Tips */}
            <div className="mt-4 p-4 rounded-xl bg-muted/30 border border-border">
              <p className="text-xs text-muted-foreground text-center">
                For the best experience, use headphones and keep this screen open
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default ListenerView;
