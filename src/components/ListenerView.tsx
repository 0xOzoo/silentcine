import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useListenerSession, AudioTrack, SubtitleTrack } from "@/hooks/useSession";
import SyncCalibration from "./SyncCalibration";
import TrackSelector from "./TrackSelector";

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
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSyncRef = useRef<string | null>(null);

  const { session, isConnected, isLoading, connect } = useListenerSession(inputCode);

  const handleConnect = async () => {
    if (inputCode.length > 0) {
      await connect();
    }
  };

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
    // In a real implementation, this would switch the audio track
    // For now, we just store the preference
  };

  // Handle subtitle track change
  const handleSubtitleTrackChange = (index: number) => {
    setSelectedSubtitleTrack(index);
    if (index === -1) {
      setCurrentSubtitle(null);
    }
    // In a real implementation, this would enable/disable subtitle tracks
  };

  // Sync playback with host (with calibration offset)
  useEffect(() => {
    if (!session || !audioRef.current || !session.audio_url) return;
    
    // Only sync if the sync timestamp has changed
    if (lastSyncRef.current === session.last_sync_at) return;
    lastSyncRef.current = session.last_sync_at;

    const audio = audioRef.current;
    const targetTimeSeconds = session.current_time_ms / 1000;
    
    // Calculate time drift compensation with sync offset
    const timeSinceSync = (Date.now() - new Date(session.last_sync_at).getTime()) / 1000;
    const offsetSeconds = syncOffset / 1000;
    const compensatedTime = session.is_playing 
      ? targetTimeSeconds + timeSinceSync + offsetSeconds
      : targetTimeSeconds + offsetSeconds;

    // Only seek if we're more than 0.5 seconds off
    const currentDiff = Math.abs(audio.currentTime - compensatedTime);
    if (currentDiff > 0.5) {
      audio.currentTime = Math.max(0, compensatedTime);
    }

    // Handle play/pause
    if (session.is_playing && audio.paused) {
      audio.play().catch(err => console.log('Autoplay blocked:', err));
      setLocalIsPlaying(true);
    } else if (!session.is_playing && !audio.paused) {
      audio.pause();
      setLocalIsPlaying(false);
    }
  }, [session, syncOffset]);

  // Handle manual play/pause toggle
  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (localIsPlaying) {
      audioRef.current.pause();
      setLocalIsPlaying(false);
    } else {
      audioRef.current.play().catch(err => console.log('Play blocked:', err));
      setLocalIsPlaying(true);
    }
  };

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

              <Button
                variant="hero"
                size="xl"
                className="w-full"
                onClick={handleConnect}
                disabled={inputCode.length === 0 || isLoading}
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-foreground"></div>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              Make sure your volume is turned up and headphones are connected
            </p>
          </motion.div>
        ) : (
          /* Player View */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="cinema-card rounded-3xl p-8 border border-border"
          >
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

            {/* Hidden Audio Element */}
            {session?.audio_url && (
              <audio
                ref={audioRef}
                src={session.audio_url}
                preload="auto"
                crossOrigin="anonymous"
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
                ) : (
                  <Headphones className="w-12 h-12 text-primary/50" />
                )}
              </motion.div>

              <p className="text-muted-foreground text-sm">
                {!session?.audio_url 
                  ? "Waiting for host to upload audio..." 
                  : localIsPlaying 
                    ? "Audio streaming..." 
                    : session?.is_playing 
                      ? "Tap play to sync with host" 
                      : "Waiting for host to start..."}
              </p>
            </div>

            {/* Play Button */}
            <div className="flex justify-center mb-8">
              <button
                onClick={togglePlay}
                disabled={!session?.audio_url}
                className="w-20 h-20 rounded-full bg-gradient-to-r from-primary to-glow-secondary flex items-center justify-center shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {localIsPlaying ? (
                  <Pause className="w-8 h-8 text-primary-foreground" />
                ) : (
                  <Play className="w-8 h-8 text-primary-foreground ml-1" />
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

            {/* Tips */}
            <div className="mt-4 p-4 rounded-xl bg-muted/30 border border-border">
              <p className="text-xs text-muted-foreground text-center">
                💡 For the best experience, use headphones and keep this screen open
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default ListenerView;
