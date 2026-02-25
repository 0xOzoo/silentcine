import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Languages, Volume2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

import type { AudioTrack, SubtitleTrack } from "@/hooks/useSession";
// Re-export types for backward compatibility
export type { AudioTrack, SubtitleTrack } from "@/hooks/useSession";

interface TrackSelectorProps {
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  selectedAudioTrack: number;
  selectedSubtitleTrack: number;
  onAudioTrackChange: (index: number) => void;
  onSubtitleTrackChange: (index: number) => void;
}

const TrackSelector = ({
  audioTracks,
  subtitleTracks,
  selectedAudioTrack,
  selectedSubtitleTrack,
  onAudioTrackChange,
  onSubtitleTrackChange,
}: TrackSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'audio' | 'subtitles'>('audio');

  const hasAudioTracks = audioTracks.length > 1;
  const hasSubtitleTracks = subtitleTracks.length > 0;

  if (!hasAudioTracks && !hasSubtitleTracks) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <Languages className="w-4 h-4" />
        Tracks
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-card border border-border rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-bold text-lg">Audio & Subtitles</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  className="h-8 w-8"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 mb-4">
                {hasAudioTracks && (
                  <button
                    onClick={() => setActiveTab('audio')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-colors ${
                      activeTab === 'audio'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Volume2 className="w-4 h-4 inline-block mr-2" />
                    Audio
                  </button>
                )}
                {hasSubtitleTracks && (
                  <button
                    onClick={() => setActiveTab('subtitles')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-colors ${
                      activeTab === 'subtitles'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Languages className="w-4 h-4 inline-block mr-2" />
                    Subtitles
                  </button>
                )}
              </div>

              {/* Track list */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {activeTab === 'audio' && audioTracks.map((track) => (
                  <button
                    key={track.index}
                    onClick={() => onAudioTrackChange(track.index)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                      selectedAudioTrack === track.index
                        ? 'bg-primary/20 border border-primary/30'
                        : 'bg-secondary hover:bg-secondary/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Volume2 className="w-4 h-4 text-muted-foreground" />
                      <div className="text-left">
                        <div className="font-medium text-sm">{track.label}</div>
                        {track.language && (
                          <div className="text-xs text-muted-foreground uppercase">
                            {track.language}
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedAudioTrack === track.index && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </button>
                ))}

                {activeTab === 'subtitles' && (
                  <>
                    {/* Off option */}
                    <button
                      onClick={() => onSubtitleTrackChange(-1)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                        selectedSubtitleTrack === -1
                          ? 'bg-primary/20 border border-primary/30'
                          : 'bg-secondary hover:bg-secondary/80'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Languages className="w-4 h-4 text-muted-foreground" />
                        <div className="font-medium text-sm">Off</div>
                      </div>
                      {selectedSubtitleTrack === -1 && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </button>
                    
                    {subtitleTracks.map((track) => (
                      <button
                        key={track.index}
                        onClick={() => onSubtitleTrackChange(track.index)}
                        className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                          selectedSubtitleTrack === track.index
                            ? 'bg-primary/20 border border-primary/30'
                            : 'bg-secondary hover:bg-secondary/80'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Languages className="w-4 h-4 text-muted-foreground" />
                          <div className="text-left">
                            <div className="font-medium text-sm">{track.label}</div>
                            {track.language && (
                              <div className="text-xs text-muted-foreground uppercase">
                                {track.language}
                              </div>
                            )}
                          </div>
                        </div>
                        {selectedSubtitleTrack === track.index && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </>
                )}
              </div>

              <p className="text-xs text-muted-foreground text-center mt-4">
                Changes apply to your device only
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default TrackSelector;
