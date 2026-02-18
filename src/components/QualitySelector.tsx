import { useState } from "react";
import { Monitor, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type QualityProfile, TIER_LIMITS, type SubscriptionTier } from "@/types/profile";

interface QualitySelectorProps {
  /** Currently selected quality */
  currentQuality: QualityProfile;
  /** Available quality variants for this movie (from movies.variants) */
  availableQualities: QualityProfile[];
  /** Host's subscription tier (determines what's unlocked) */
  tier: SubscriptionTier;
  /** Callback when quality changes */
  onQualityChange: (quality: QualityProfile) => void;
  /** Whether a quality switch is in progress */
  isLoading?: boolean;
}

const QUALITY_LABELS: Record<QualityProfile, { label: string; description: string }> = {
  "720p": { label: "720p", description: "HD — Best for mobile" },
  "1080p": { label: "1080p", description: "Full HD" },
  "4k_hdr": { label: "4K HDR", description: "Ultra HD" },
};

const ALL_QUALITIES: QualityProfile[] = ["720p", "1080p", "4k_hdr"];

export default function QualitySelector({
  currentQuality,
  availableQualities,
  tier,
  onQualityChange,
  isLoading = false,
}: QualitySelectorProps) {
  const [open, setOpen] = useState(false);

  const maxQuality = TIER_LIMITS[tier].maxQuality;
  const maxQualityIndex = ALL_QUALITIES.indexOf(maxQuality);

  const isQualityAllowed = (quality: QualityProfile): boolean => {
    const qualityIndex = ALL_QUALITIES.indexOf(quality);
    return qualityIndex <= maxQualityIndex;
  };

  const isQualityAvailable = (quality: QualityProfile): boolean => {
    return availableQualities.includes(quality);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          className="gap-2"
        >
          <Monitor className="w-3.5 h-3.5" />
          {isLoading ? "Switching..." : QUALITY_LABELS[currentQuality].label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {ALL_QUALITIES.map((quality) => {
          const allowed = isQualityAllowed(quality);
          const available = isQualityAvailable(quality);
          const isCurrent = quality === currentQuality;
          const info = QUALITY_LABELS[quality];

          return (
            <DropdownMenuItem
              key={quality}
              disabled={!allowed || !available || isLoading}
              className={`flex items-center justify-between ${
                isCurrent ? "bg-primary/10" : ""
              }`}
              onClick={() => {
                if (allowed && available && !isCurrent) {
                  onQualityChange(quality);
                  setOpen(false);
                }
              }}
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {info.label}
                  {isCurrent && (
                    <span className="ml-2 text-xs text-primary">(current)</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {info.description}
                </span>
              </div>
              {!allowed && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="w-3 h-3" />
                  <span>
                    {quality === "4k_hdr" ? "Enterprise" : "Pro"}
                  </span>
                </div>
              )}
              {allowed && !available && (
                <span className="text-xs text-muted-foreground">
                  Not available
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
