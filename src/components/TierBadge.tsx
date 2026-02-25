import { Badge } from '@/components/ui/badge';
import { Crown, Building2, Ticket, Zap } from 'lucide-react';
import type { SubscriptionTier } from '@/types/profile';

const TIER_CONFIG: Record<SubscriptionTier, {
  label: string;
  className: string;
  icon: React.ReactNode;
}> = {
  free: {
    label: 'Free',
    className: 'bg-muted text-muted-foreground border-muted',
    icon: <Zap className="w-3 h-3" />,
  },
  event: {
    label: 'Event',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    icon: <Ticket className="w-3 h-3" />,
  },
  pro: {
    label: 'Pro',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    icon: <Crown className="w-3 h-3" />,
  },
  enterprise: {
    label: 'Enterprise',
    className: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    icon: <Building2 className="w-3 h-3" />,
  },
};

interface TierBadgeProps {
  tier: SubscriptionTier;
  showIcon?: boolean;
  className?: string;
}

/**
 * Reusable tier badge with distinct colors per tier.
 * Free = gray, Event = blue, Pro = gold, Enterprise = purple.
 */
const TierBadge = ({ tier, showIcon = true, className = '' }: TierBadgeProps) => {
  const config = TIER_CONFIG[tier];

  return (
    <Badge
      variant="outline"
      className={`gap-1 text-xs font-medium ${config.className} ${className}`}
    >
      {showIcon && config.icon}
      {config.label}
    </Badge>
  );
};

export default TierBadge;
