import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TierBadge from './TierBadge';
import type { SubscriptionTier } from '@/types/profile';

interface AccessDeniedProps {
  /** Feature name that's blocked (e.g., "1080p streaming") */
  feature: string;
  /** Minimum tier required to access this feature */
  requiredTier: SubscriptionTier;
  /** Current user tier */
  currentTier: SubscriptionTier;
  /** Optional description explaining why */
  description?: string;
  /** Render as a compact inline card vs full-page block */
  compact?: boolean;
}

/**
 * Displayed when a user attempts to use a feature above their tier.
 * Shows current vs required tier with an upgrade CTA.
 */
const AccessDenied = ({
  feature,
  requiredTier,
  currentTier,
  description,
  compact = false,
}: AccessDeniedProps) => {
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 text-sm">
          <span className="font-medium">{feature}</span>
          <span className="text-muted-foreground"> requires </span>
          <TierBadge tier={requiredTier} showIcon={false} />
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/pricing">Upgrade</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-muted/50 p-4 mb-4">
        <Lock className="w-8 h-8 text-muted-foreground" />
      </div>
      <h2 className="font-display text-xl font-bold mb-2">
        {feature} requires an upgrade
      </h2>
      <p className="text-muted-foreground text-sm max-w-sm mb-4">
        {description || `This feature is available on the ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} plan and above.`}
      </p>
      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs text-muted-foreground">Your plan:</span>
        <TierBadge tier={currentTier} />
        <span className="text-xs text-muted-foreground mx-1">-&gt;</span>
        <TierBadge tier={requiredTier} />
      </div>
      <Button asChild>
        <Link to="/pricing">View Plans</Link>
      </Button>
    </div>
  );
};

export default AccessDenied;
