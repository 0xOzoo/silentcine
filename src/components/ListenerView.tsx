import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface ListenerViewProps {
  onBack: () => void;
  sessionId?: string;
}

const ListenerView = ({ onBack, sessionId }: ListenerViewProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [inputCode, setInputCode] = useState(sessionId || "");

  const handleConnect = () => {
    if (inputCode.length > 0) {
      setIsConnected(true);
    }
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

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
                disabled={inputCode.length === 0}
              >
                Connect
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
                Session: {inputCode}
              </h2>
            </div>

            {/* Now Playing */}
            <div className="text-center py-8">
              <motion.div
                animate={{
                  scale: isPlaying ? [1, 1.05, 1] : 1,
                }}
                transition={{
                  duration: 2,
                  repeat: isPlaying ? Infinity : 0,
                  ease: "easeInOut",
                }}
                className="w-32 h-32 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/20 to-glow-secondary/20 flex items-center justify-center border border-primary/30 cinema-glow"
              >
                {isPlaying ? (
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
                {isPlaying ? "Audio streaming..." : "Ready to play"}
              </p>
            </div>

            {/* Play Button */}
            <div className="flex justify-center mb-8">
              <button
                onClick={togglePlay}
                className="w-20 h-20 rounded-full bg-gradient-to-r from-primary to-glow-secondary flex items-center justify-center shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-all hover:scale-105 active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="w-8 h-8 text-primary-foreground" />
                ) : (
                  <Play className="w-8 h-8 text-primary-foreground ml-1" />
                )}
              </button>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-4">
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

            {/* Tips */}
            <div className="mt-8 p-4 rounded-xl bg-muted/30 border border-border">
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
