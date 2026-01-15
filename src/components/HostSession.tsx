import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Upload, Play, Pause, Volume2, Copy, Check, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface HostSessionProps {
  onBack: () => void;
}

const HostSession = ({ onBack }: HostSessionProps) => {
  const [sessionId] = useState(() => Math.random().toString(36).substring(2, 10).toUpperCase());
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const sessionUrl = `${window.location.origin}/listen/${sessionId}`;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
    }
  };

  const togglePlayback = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

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

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="min-h-screen py-10 px-4"
    >
      <div className="container max-w-4xl mx-auto">
        {/* Header */}
        <Button variant="ghost" onClick={onBack} className="mb-8">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Left: QR Code & Session Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="cinema-card rounded-3xl p-8 border border-border text-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Radio className="w-3.5 h-3.5 animate-pulse-glow" />
              Session Live
            </div>

            <h2 className="font-display text-2xl font-bold text-foreground mb-2">
              Session: {sessionId}
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              Share this QR code with your audience
            </p>

            {/* QR Code */}
            <div className="bg-foreground p-6 rounded-2xl inline-block mb-6 cinema-glow">
              <QRCodeSVG
                value={sessionUrl}
                size={200}
                level="H"
                includeMargin={false}
                bgColor="hsl(40 20% 95%)"
                fgColor="hsl(240 10% 4%)"
              />
            </div>

            {/* Copy Link */}
            <div className="flex gap-2">
              <Input
                value={sessionUrl}
                readOnly
                className="bg-secondary/50 border-border text-sm"
              />
              <Button variant="cinema" size="icon" onClick={copyLink}>
                {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </motion.div>

          {/* Right: Audio Controls */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="cinema-card rounded-3xl p-8 border border-border"
          >
            <h3 className="font-display text-xl font-bold text-foreground mb-6">
              Audio Source
            </h3>

            {!audioFile ? (
              <label className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-border rounded-2xl cursor-pointer hover:border-primary/50 transition-colors">
                <Upload className="w-10 h-10 text-muted-foreground mb-3" />
                <span className="text-muted-foreground text-sm">Click to upload audio file</span>
                <span className="text-muted-foreground text-xs mt-1">MP3, WAV, AAC</span>
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            ) : (
              <div className="space-y-6">
                {/* File Info */}
                <div className="flex items-center gap-3 p-4 bg-secondary/50 rounded-xl">
                  <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Volume2 className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{audioFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(audioFile.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary to-glow-secondary"
                      style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>

                {/* Play Controls */}
                <div className="flex justify-center">
                  <Button
                    variant="hero"
                    size="lg"
                    onClick={togglePlayback}
                    className="w-40"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="w-5 h-5" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="w-5 h-5" />
                        Start
                      </>
                    )}
                  </Button>
                </div>

                {/* Hidden Audio Element */}
                {audioUrl && (
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                  />
                )}
              </div>
            )}

            {/* Instructions */}
            <div className="mt-8 p-4 rounded-xl bg-muted/30 border border-border">
              <h4 className="text-sm font-medium text-foreground mb-2">How it works</h4>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Upload your movie's audio track</li>
                <li>Display the QR code to your audience</li>
                <li>Press play when your video starts</li>
                <li>Viewers hear audio through their devices</li>
              </ol>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};

export default HostSession;
