import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings2, X, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface SyncCalibrationProps {
  offsetMs: number;
  onOffsetChange: (offset: number) => void;
}

const SyncCalibration = ({ offsetMs, onOffsetChange }: SyncCalibrationProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const adjustOffset = (delta: number) => {
    const newOffset = Math.max(-5000, Math.min(5000, offsetMs + delta));
    onOffsetChange(newOffset);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <Settings2 className="w-4 h-4" />
        Sync
        {offsetMs !== 0 && (
          <span className="text-xs text-muted-foreground">
            ({offsetMs > 0 ? '+' : ''}{offsetMs}ms)
          </span>
        )}
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-display font-bold text-lg">Sync Calibration</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  className="h-8 w-8"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-muted-foreground text-sm mb-6">
                Adjust the audio offset if it's out of sync with the video. 
                Negative values = audio earlier, positive = audio later.
              </p>

              {/* Current offset display */}
              <div className="text-center mb-6">
                <div className="text-4xl font-mono font-bold text-foreground">
                  {offsetMs > 0 ? '+' : ''}{offsetMs}
                  <span className="text-lg text-muted-foreground ml-1">ms</span>
                </div>
              </div>

              {/* Quick adjust buttons */}
              <div className="flex items-center justify-center gap-2 mb-6">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => adjustOffset(-100)}
                  className="h-12 w-12"
                >
                  <Minus className="w-5 h-5" />
                </Button>
                
                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => adjustOffset(-500)}
                  >
                    -500
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOffsetChange(0)}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => adjustOffset(500)}
                  >
                    +500
                  </Button>
                </div>
                
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => adjustOffset(100)}
                  className="h-12 w-12"
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </div>

              {/* Slider for fine control */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-5s (earlier)</span>
                  <span>+5s (later)</span>
                </div>
                <Slider
                  value={[offsetMs]}
                  onValueChange={([val]) => onOffsetChange(val)}
                  min={-5000}
                  max={5000}
                  step={50}
                />
              </div>

              <p className="text-xs text-muted-foreground text-center mt-4">
                Tip: If audio plays before video action, use positive values
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default SyncCalibration;
