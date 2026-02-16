import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Upload, Play, Pause, Copy, Check, Radio, Users, Maximize, Minimize, Link, Share2, AlertTriangle, ExternalLink, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useHostSession, AudioTrack, SubtitleTrack } from "@/hooks/useSession";
import PiPQRCode from "./PiPQRCode";
import {
  extractAudioFromVideo,
  isVideoFile,
  isAudioFile,
  terminateFFmpeg,
  isMobileHost,
  getFileSizeLimit,
  ExtractionError,
  type ExtractionProgress,
} from "@/utils/extractAudio";

/** Pipeline phases for the multi-step upload process */
type PipelinePhase = "idle" | "extracting" | "uploading" | "done" | "error";

interface HostSessionProps {
  onBack: () => void;
}

const HostSession = ({ onBack }: HostSessionProps) => {
  const { session, listeners, isLoading, createSession, uploadAudio, updatePlaybackState, updateVideoInfo } = useHostSession();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null);
  const [uploadEta, setUploadEta] = useState<number | null>(null);
  const uploadStartTimeRef = useRef<number>(0);
  const lastUploadedRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const fileSizeRef = useRef<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Audio extraction pipeline state ──
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>("idle");
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [showFallbackHelp, setShowFallbackHelp] = useState(false);

  // Create session on mount
  useEffect(() => {
    createSession();
  }, [createSession]);

  const sessionUrl = session ? `${window.location.origin}/listen/${session.code}` : '';

  // Extract tracks from video element
  const extractTracks = (video: HTMLVideoElement): { audioTracks: AudioTrack[], subtitleTracks: SubtitleTrack[] } => {
    const audioTracks: AudioTrack[] = [];
    const subtitleTracks: SubtitleTrack[] = [];
    
    // Extract audio tracks if available
    // @ts-ignore - audioTracks is not in all browsers
    if (video.audioTracks) {
      // @ts-ignore
      for (let i = 0; i < video.audioTracks.length; i++) {
        // @ts-ignore
        const track = video.audioTracks[i];
        audioTracks.push({
          index: i,
          label: track.label || `Audio ${i + 1}`,
          language: track.language || 'unknown',
        });
      }
    }
    
    // Add default track if none found
    if (audioTracks.length === 0) {
      audioTracks.push({
        index: 0,
        label: 'Default Audio',
        language: 'unknown',
      });
    }
    
    // Extract text tracks (subtitles/captions)
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.kind === 'subtitles' || track.kind === 'captions') {
          subtitleTracks.push({
            index: i,
            label: track.label || `Subtitle ${i + 1}`,
            language: track.language || 'unknown',
          });
        }
      }
    }
    
    return { audioTracks, subtitleTracks };
  };

  // Format seconds to human readable time
  const formatEta = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.round((seconds % 3600) / 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
  };

  /**
   * Upload a file (File or Blob) to Supabase with progress tracking.
   * Shared by both the direct-audio and post-extraction paths.
   */
  const uploadFileToSupabase = useCallback(async (
    fileOrBlob: File | Blob,
    originalFileName: string,
  ): Promise<string | null> => {
    setIsUploading(true);
    setPipelinePhase("uploading");
    setUploadProgress(0);
    setUploadSpeed(null);
    setUploadEta(null);
    uploadStartTimeRef.current = Date.now();
    lastUploadedRef.current = 0;
    lastTimeRef.current = Date.now();

    const fileSize = fileOrBlob.size;
    fileSizeRef.current = fileSize;

    // If we got a Blob (from extraction), wrap it as a File for the upload API
    const uploadFile =
      fileOrBlob instanceof File
        ? fileOrBlob
        : new File([fileOrBlob], originalFileName, { type: fileOrBlob.type });

    const audioUrl = await uploadAudio(uploadFile, (progress) => {
      setUploadProgress(progress);

      const now = Date.now();
      const bytesUploaded = (progress / 100) * fileSize;
      const timeDiff = (now - lastTimeRef.current) / 1000;

      if (timeDiff >= 0.5) {
        const bytesDiff = bytesUploaded - lastUploadedRef.current;
        const speedBytesPerSec = bytesDiff / timeDiff;
        const speedMBps = speedBytesPerSec / (1024 * 1024);
        setUploadSpeed(speedMBps);

        if (speedBytesPerSec > 0) {
          const remainingBytes = fileSize - bytesUploaded;
          setUploadEta(remainingBytes / speedBytesPerSec);
        }

        lastUploadedRef.current = bytesUploaded;
        lastTimeRef.current = now;
      }
    });

    setUploadProgress(100);
    setUploadSpeed(null);
    setUploadEta(null);

    setTimeout(() => {
      setIsUploading(false);
      setUploadProgress(0);
    }, 500);

    return audioUrl;
  }, [uploadAudio]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;

    // Reset pipeline state
    setPipelineError(null);
    setShowFallbackHelp(false);
    setExtractionProgress(null);

    // Create local URL for video playback immediately (works for video files)
    if (isVideoFile(file)) {
      setVideoFile(file);
      const localUrl = URL.createObjectURL(file);
      setVideoUrl(localUrl);

      // ── Video file: extract audio first, then upload ──
      setPipelinePhase("extracting");
      setIsUploading(true);

      try {
        const audioBlob = await extractAudioFromVideo(file, (progress) => {
          setExtractionProgress(progress);
        });

        // Free ffmpeg memory now that extraction is done
        terminateFFmpeg();

        // Derive a filename for the extracted audio
        const baseName = file.name.replace(/\.[^.]+$/, "");
        const audioFileName = `${baseName}.mp3`;

        const audioUrl = await uploadFileToSupabase(audioBlob, audioFileName);

        setPipelinePhase("done");

        if (!audioUrl) {
          toast.info("Video loaded locally. Audio extraction succeeded but upload failed — listeners cannot hear audio yet.");
        } else {
          toast.success("Audio extracted and uploaded! Listeners can now connect.");
        }
      } catch (err) {
        setPipelinePhase("error");
        setIsUploading(false);
        terminateFFmpeg();

        if (err instanceof ExtractionError) {
          setPipelineError(err.message);
          setShowFallbackHelp(err.showFallback);
          toast.error("Audio extraction failed");
        } else {
          setPipelineError("An unexpected error occurred during audio extraction.");
          setShowFallbackHelp(true);
          toast.error("Audio extraction failed");
        }
      }
    } else if (isAudioFile(file)) {
      // ── Audio file: upload directly (no extraction needed) ──
      setVideoFile(file);

      const audioUrl = await uploadFileToSupabase(file, file.name);
      setPipelinePhase("done");

      if (audioUrl) {
        toast.success("Audio uploaded successfully!");
      } else {
        toast.error("Audio upload failed.");
      }
    } else {
      // ── Unknown file type ──
      toast.error("Unsupported file type. Please upload a video (MP4, WebM, MKV) or audio (MP3, WAV, OGG) file.");
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlInput.trim() || !session) return;
    
    setIsUploading(true);
    setVideoUrl(urlInput.trim());
    
    // Update session with video URL
    await updateVideoInfo(urlInput.trim(), [], []);
    
    toast.success("Video URL loaded!");
    setIsUploading(false);
    setShowUrlInput(false);
    setUrlInput("");
  };

  // Handle video metadata load to extract tracks
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      
      // Extract and save tracks
      const { audioTracks, subtitleTracks } = extractTracks(videoRef.current);
      if (session && videoUrl) {
        updateVideoInfo(videoUrl, audioTracks, subtitleTracks);
      }
    }
  };

  const togglePlayback = async () => {
    if (videoRef.current) {
      const newIsPlaying = !isPlaying;
      const currentTimeMs = Math.floor(videoRef.current.currentTime * 1000);
      
      if (newIsPlaying) {
        videoRef.current.play();
        // Start sync interval - every 2 seconds to stay within rate limits
        // (60 req/min limit = max 1 every 1s, but 2s gives safety margin)
        syncIntervalRef.current = setInterval(() => {
          if (videoRef.current) {
            updatePlaybackState(true, Math.floor(videoRef.current.currentTime * 1000));
          }
        }, 2000);
      } else {
        videoRef.current.pause();
        // Stop sync interval
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current);
          syncIntervalRef.current = null;
        }
      }
      
      setIsPlaying(newIsPlaying);
      await updatePlaybackState(newIsPlaying, currentTimeMs);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleEnded = async () => {
    setIsPlaying(false);
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }
    await updatePlaybackState(false, 0);
  };

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  /** Seek forward or backward by a relative number of seconds */
  const seekRelative = useCallback((seconds: number) => {
    if (!videoRef.current) return;
    const newTime = Math.max(0, Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    // Push an immediate sync so listeners follow the seek
    if (isPlaying) {
      updatePlaybackState(true, Math.floor(newTime * 1000));
    }
  }, [isPlaying, updatePlaybackState]);

  // Keyboard shortcuts for theater/projector mode (desktop only)
  useEffect(() => {
    if (!videoUrl) return;
    if (isMobileHost()) return; // No keyboard shortcuts on mobile

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlayback();
          break;
        case "ArrowRight":
          e.preventDefault();
          seekRelative(10);
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekRelative(-10);
          break;
        case "KeyF":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "KeyM":
          e.preventDefault();
          // Toggle mute on the video element (host projector audio)
          if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoUrl, togglePlayback, seekRelative, toggleFullscreen]);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const copyLink = () => {
    navigator.clipboard.writeText(sessionUrl);
    setCopied(true);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareSession = useCallback(async () => {
    if (!session) return;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SilentScreen - ${session.title}`,
          text: `Join the silent cinema session: ${session.code}`,
          url: sessionUrl,
        });
      } catch (err) {
        // User cancelled or share failed - fall back to copy
        if ((err as Error).name !== 'AbortError') {
          navigator.clipboard.writeText(sessionUrl);
          setCopied(true);
          toast.success("Link copied to clipboard!");
          setTimeout(() => setCopied(false), 2000);
        }
      }
    } else {
      navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    }
  }, [session, sessionUrl]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
      // Free ffmpeg WASM memory if loaded
      terminateFFmpeg();
    };
  }, []);

  if (isLoading && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Theater mode when video is loaded
  if (videoUrl) {
    return (
      <div 
        ref={containerRef}
        className={`min-h-screen bg-black flex ${isFullscreen ? 'p-0' : 'p-4'}`}
      >
        {/* Video Area - Takes most of the screen */}
        <div className="flex-1 flex items-center justify-center relative">
          <video
            ref={videoRef}
            src={videoUrl}
            className="max-h-full max-w-full object-contain"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onClick={togglePlayback}
            playsInline
            muted
            crossOrigin="anonymous"
          />
          
          {/* Play/Pause overlay */}
          {!isPlaying && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer"
              onClick={togglePlayback}
            >
              <div className="w-24 h-24 rounded-full bg-primary/80 flex items-center justify-center shadow-2xl">
                <Play className="w-12 h-12 text-primary-foreground ml-2" />
              </div>
            </motion.div>
          )}

          {/* Bottom controls bar */}
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
            <div className="flex items-center gap-4">
              {/* Progress bar */}
              <div className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden cursor-pointer"
                onClick={(e) => {
                  if (videoRef.current) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const percent = (e.clientX - rect.left) / rect.width;
                    videoRef.current.currentTime = percent * duration;
                  }
                }}
              >
                <div 
                  className="h-full bg-primary"
                  style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
                />
              </div>
              
              {/* Time */}
              <span className="text-white text-sm font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              
              {/* Play/Pause button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlayback}
                className="text-white hover:bg-white/20"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </Button>
              
              {/* Fullscreen toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFullscreen}
                className="text-white hover:bg-white/20"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </Button>
            </div>
          </div>

          {/* Back button (top left, only when not fullscreen) */}
          {!isFullscreen && (
            <Button 
              variant="ghost" 
              onClick={onBack} 
              className="absolute top-4 left-4 text-white hover:bg-white/20"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          )}
        </div>

        {/* QR Code Sidebar */}
        <div className={`flex flex-col items-center justify-center bg-background/95 backdrop-blur ${isFullscreen ? 'w-64 p-4' : 'w-72 p-6 rounded-2xl ml-4'}`}>
          {/* Pipeline Status */}
          {pipelinePhase === "extracting" ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 text-violet-500 text-sm font-medium mb-4"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-3.5 h-3.5 rounded-full border-2 border-violet-500/30 border-t-violet-500"
              />
              Extracting Audio...
            </motion.div>
          ) : isUploading ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-500 text-sm font-medium mb-4"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-3.5 h-3.5 rounded-full border-2 border-amber-500/30 border-t-amber-500"
              />
              Uploading Audio...
            </motion.div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              <Radio className="w-3.5 h-3.5 animate-pulse-glow" />
              {session?.audio_url ? "Ready to Stream" : "Session Live"}
            </div>
          )}

          <h2 className="font-display text-lg font-bold text-foreground mb-1 text-center">
            Scan to Listen
          </h2>
          <p className="text-muted-foreground text-xs mb-4 text-center">
            Session: {session?.code}
          </p>

          {/* Pipeline Progress Bar (extraction + upload) */}
          {pipelinePhase === "extracting" && extractionProgress && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full mb-4"
            >
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{extractionProgress.message}</span>
                <span className="font-medium">{extractionProgress.percent}%</span>
              </div>
              <Progress value={extractionProgress.percent} className="h-2" />
            </motion.div>
          )}
          {pipelinePhase === "uploading" && isUploading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full mb-4"
            >
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span className="flex items-center gap-1.5">
                  Uploading...
                  {uploadSpeed !== null && uploadSpeed > 0 && (
                    <span className="text-primary font-medium">
                      {uploadSpeed >= 1 
                        ? `${uploadSpeed.toFixed(1)} MB/s` 
                        : `${(uploadSpeed * 1024).toFixed(0)} KB/s`}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {uploadEta !== null && uploadEta > 0 && uploadProgress < 99 && (
                    <span className="text-muted-foreground/70">
                      ~{formatEta(uploadEta)} left
                    </span>
                  )}
                  <span className="font-medium">{Math.round(uploadProgress)}%</span>
                </span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </motion.div>
          )}

          {/* QR Code */}
          <div className="bg-white p-4 rounded-xl mb-4">
            <QRCodeSVG
              value={sessionUrl}
              size={160}
              level="H"
              includeMargin={false}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>

          {/* Listener count */}
          <div className="flex items-center gap-2 text-muted-foreground mb-4">
            <Users className="w-4 h-4" />
            <span className="text-sm">
              {listeners.length} listener{listeners.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Audio Status */}
          {!isUploading && (
            <div className={`text-xs mb-3 px-3 py-1.5 rounded-full ${session?.audio_url ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'}`}>
              {session?.audio_url ? '✓ Audio ready for listeners' : 'Preparing audio...'}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 w-full">
            {/* Web Share API on supported devices, otherwise copy */}
            {typeof navigator !== 'undefined' && navigator.share ? (
              <Button
                variant="cinema"
                size="sm"
                onClick={shareSession}
                className="w-full"
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share Link
              </Button>
            ) : (
              <Button
                variant="cinema"
                size="sm"
                onClick={copyLink}
                className="w-full"
              >
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? 'Copied!' : 'Copy Link'}
              </Button>
            )}
            
            {/* PiP QR Code */}
            <PiPQRCode url={sessionUrl} sessionCode={session?.code || ''} />
          </div>

          {/* Instructions */}
          <div className="mt-4 text-xs text-muted-foreground text-center">
            <p>Point your phone camera at the QR code to get audio</p>
          </div>
        </div>
      </div>
    );
  }

  // Upload view (no video yet)
  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="min-h-screen py-10 px-4"
    >
      <div className="container max-w-2xl mx-auto">
        {/* Header */}
        <Button variant="ghost" onClick={onBack} className="mb-8">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="cinema-card rounded-3xl p-8 border border-border text-center"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Radio className="w-3.5 h-3.5 animate-pulse-glow" />
            Session: {session?.code}
          </div>

          <h2 className="font-display text-2xl font-bold text-foreground mb-2">
            Upload Your Movie
          </h2>
          <p className="text-muted-foreground text-sm mb-8">
            Upload a video file or paste a video URL to project.
          </p>

          {/* Toggle between upload and URL */}
          <div className="flex gap-2 justify-center mb-6">
            <Button
              variant={!showUrlInput ? "default" : "outline"}
              size="sm"
              onClick={() => setShowUrlInput(false)}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </Button>
            <Button
              variant={showUrlInput ? "default" : "outline"}
              size="sm"
              onClick={() => setShowUrlInput(true)}
            >
              <Link className="w-4 h-4 mr-2" />
              Paste URL
            </Button>
          </div>

          {showUrlInput ? (
            /* URL Input */
            <div className="space-y-4">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/video.mp4"
                className="w-full h-14 px-6 rounded-xl bg-secondary border border-border text-center text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
              />
              <Button
                variant="hero"
                size="xl"
                className="w-full"
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim() || isUploading}
              >
                {isUploading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-foreground"></div>
                ) : (
                  'Load Video'
                )}
              </Button>
              <p className="text-muted-foreground text-xs">
                Paste a direct link to an MP4, WebM, MKV, or other video file
              </p>
            </div>
          ) : (
            /* File Upload with multi-phase pipeline UI */
            <>
              <label className={`flex flex-col items-center justify-center h-64 border-2 border-dashed border-border rounded-2xl cursor-pointer hover:border-primary/50 transition-colors ${isUploading || pipelinePhase === 'error' ? 'pointer-events-none' : ''}`}>
                {pipelinePhase === "extracting" && extractionProgress ? (
                  /* Phase 1: Extracting audio from video */
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center w-full px-8"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="w-14 h-14 rounded-full border-3 border-violet-500/20 border-t-violet-500 mb-4"
                    />
                    <span className="text-foreground font-medium mb-1">
                      {extractionProgress.phase === "loading"
                        ? "Loading audio processor..."
                        : "Extracting audio from video..."}
                    </span>
                    <span className="text-muted-foreground text-xs mb-3">
                      {extractionProgress.message}
                    </span>
                    <div className="w-full max-w-xs">
                      <Progress value={extractionProgress.percent} className="h-2" />
                    </div>
                    <span className="text-muted-foreground text-sm mt-2">
                      {extractionProgress.percent}%
                    </span>
                  </motion.div>
                ) : pipelinePhase === "uploading" ? (
                  /* Phase 2: Uploading extracted audio */
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center w-full px-8"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      className="w-14 h-14 rounded-full border-3 border-primary/20 border-t-primary mb-4"
                    />
                    <span className="text-foreground font-medium mb-1">Uploading audio...</span>
                    <span className="text-muted-foreground text-xs mb-3">
                      Sending extracted audio to server
                      {uploadSpeed !== null && uploadSpeed > 0 && (
                        <> &middot; {uploadSpeed >= 1
                          ? `${uploadSpeed.toFixed(1)} MB/s`
                          : `${(uploadSpeed * 1024).toFixed(0)} KB/s`}</>
                      )}
                      {uploadEta !== null && uploadEta > 0 && uploadProgress < 99 && (
                        <> &middot; ~{formatEta(uploadEta)} left</>
                      )}
                    </span>
                    <div className="w-full max-w-xs">
                      <Progress value={uploadProgress} className="h-2" />
                    </div>
                    <span className="text-muted-foreground text-sm mt-2">
                      {Math.round(uploadProgress)}%
                    </span>
                  </motion.div>
                ) : (
                  /* Idle: ready for file selection */
                  <>
                    <Upload className="w-12 h-12 text-muted-foreground mb-4" />
                    <span className="text-foreground font-medium">Click to upload video or audio</span>
                    <span className="text-muted-foreground text-sm mt-1">MP4, WebM, MKV, MP3, WAV, OGG</span>
                    <span className="text-muted-foreground text-xs mt-4">
                      Video files: audio is extracted automatically before upload
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept="video/*,audio/*"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isUploading || pipelinePhase === 'extracting'}
                />
              </label>

              {/* Extraction error with fallback help */}
              <AnimatePresence>
                {pipelinePhase === "error" && pipelineError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mt-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-left"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-destructive mb-1">
                          Audio extraction failed
                        </p>
                        <p className="text-xs text-muted-foreground mb-3">
                          {pipelineError}
                        </p>

                        {showFallbackHelp && (
                          <div className="p-3 rounded-lg bg-muted/50 border border-border mb-3">
                            <p className="text-xs text-foreground font-medium mb-2">
                              Alternative: Extract audio manually
                            </p>
                            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                              <li>Open your video in VLC or use an online converter</li>
                              <li>Export/convert to MP3 format</li>
                              <li>Upload the MP3 file here instead</li>
                            </ol>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPipelinePhase("idle");
                              setPipelineError(null);
                              setShowFallbackHelp(false);
                              setIsUploading(false);
                            }}
                          >
                            <Music className="w-3 h-3 mr-1.5" />
                            Try another file
                          </Button>
                          {showFallbackHelp && (
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                            >
                              <a
                                href="https://cloudconvert.com/mp4-to-mp3"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="w-3 h-3 mr-1.5" />
                                Online converter
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* Instructions */}
          <div className="mt-8 p-4 rounded-xl bg-muted/30 border border-border text-left">
            <h4 className="text-sm font-medium text-foreground mb-2">How it works</h4>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Upload your movie file or paste a video URL</li>
              <li>The video displays on this screen for projection</li>
              <li>Audience scans the QR code with their phones</li>
              <li>They hear synced audio through their headphones</li>
            </ol>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default HostSession;
