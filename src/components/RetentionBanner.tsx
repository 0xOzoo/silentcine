import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RetentionPolicy } from '@/types/profile';

interface RetentionBannerProps {
  /** When the movie was created */
  createdAt: string;
  /** The retention policy applied to this movie */
  retentionPolicy: RetentionPolicy;
  /** Only show if expiring within this many days (default: 3) */
  warningDays?: number;
}

/**
 * Shows a countdown banner when a movie is approaching its retention expiry.
 * Displays "Expires in X days" with an "Upgrade to keep" CTA.
 * Hidden for permanent retention or if not within the warning window.
 */
const RetentionBanner = ({
  createdAt,
  retentionPolicy,
  warningDays = 3,
}: RetentionBannerProps) => {
  const expiryInfo = useMemo(() => {
    if (retentionPolicy === 'permanent') return null;

    const created = new Date(createdAt);
    const retentionDays = retentionPolicy === '7_days' ? 7 : 30;
    const expiresAt = new Date(created.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    const msRemaining = expiresAt.getTime() - now.getTime();

    if (msRemaining <= 0) {
      return { expired: true, daysLeft: 0, hoursLeft: 0, expiresAt };
    }

    const daysLeft = Math.floor(msRemaining / (24 * 60 * 60 * 1000));
    const hoursLeft = Math.floor((msRemaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    if (daysLeft > warningDays) return null;

    return { expired: false, daysLeft, hoursLeft, expiresAt };
  }, [createdAt, retentionPolicy, warningDays]);

  if (!expiryInfo) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
      <div className="flex-1">
        {expiryInfo.expired ? (
          <span className="text-yellow-200 font-medium">
            This movie has expired and will be archived soon.
          </span>
        ) : expiryInfo.daysLeft === 0 ? (
          <span className="text-yellow-200">
            Expires in <strong>{expiryInfo.hoursLeft}h</strong>
          </span>
        ) : (
          <span className="text-yellow-200">
            Expires in <strong>{expiryInfo.daysLeft}d {expiryInfo.hoursLeft}h</strong>
          </span>
        )}
      </div>
      <Button variant="outline" size="sm" asChild className="shrink-0 border-yellow-500/50 text-yellow-200 hover:bg-yellow-500/20">
        <Link to="/pricing">Upgrade to keep</Link>
      </Button>
    </div>
  );
};

export default RetentionBanner;
