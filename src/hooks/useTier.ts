import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { TIER_LIMITS, type SubscriptionTier, type QualityProfile } from '@/types/profile';

interface TierInfo {
  /** Current subscription tier */
  tier: SubscriptionTier;
  /** Human-readable label */
  label: string;
  /** Max concurrent listeners */
  maxListeners: number;
  /** Max concurrent movies */
  concurrentMovies: number;
  /** Max quality allowed */
  maxQuality: QualityProfile;
  /** Retention policy string */
  retention: string;
  /** Branding level */
  branding: 'silentcine' | 'custom' | 'white_label';
  /** Storage quota in GB */
  storageGb: number;
  /** Human-readable storage label (e.g. "2.5 GB", "1 TB") */
  storageLabel: string;
  /** Whether the user is on the free tier */
  isFree: boolean;
  /** Whether the user has a paid plan (pro or enterprise) */
  isPaid: boolean;
  /** Whether the user has an event pass */
  isEvent: boolean;
  /** Whether this tier allows 1080p */
  canStream1080p: boolean;
  /** Whether listeners are effectively unlimited */
  hasUnlimitedListeners: boolean;
  /** Whether the tier is expiring (grace period set) */
  isExpiring: boolean;
  /** Grace period expiry date (null if not expiring) */
  expiresAt: Date | null;
  /** Check if a specific quality is allowed */
  canAccessQuality: (quality: QualityProfile) => boolean;
}

const QUALITY_ORDER: QualityProfile[] = ['720p', '1080p', '4k'];

function formatStorage(gb: number): string {
  if (gb >= 1000) return `${gb / 1000} TB`;
  return `${gb} GB`;
}

/**
 * Convenience hook for tier-based feature gating.
 * Wraps useAuth().profile with derived booleans for common checks.
 */
export function useTier(): TierInfo {
  const { profile } = useAuth();

  return useMemo(() => {
    const tier = profile?.subscription_tier ?? 'free';
    const limits = TIER_LIMITS[tier];
    const maxQualityIndex = QUALITY_ORDER.indexOf(limits.maxQuality);

    const expiresAt = profile?.tier_expires_at ? new Date(profile.tier_expires_at) : null;

    return {
      tier,
      label: limits.label,
      maxListeners: limits.maxListeners,
      concurrentMovies: limits.concurrentMovies,
      maxQuality: limits.maxQuality,
      retention: limits.retention,
      branding: limits.branding,
      storageGb: limits.storageGb,
      storageLabel: formatStorage(limits.storageGb),
      isFree: tier === 'free',
      isPaid: tier === 'pro' || tier === 'enterprise',
      isEvent: tier === 'event',
      canStream1080p: maxQualityIndex >= 1,
      hasUnlimitedListeners: limits.maxListeners === -1,
      isExpiring: !!expiresAt && expiresAt > new Date(),
      expiresAt,
      canAccessQuality: (quality: QualityProfile) => {
        const requestedIndex = QUALITY_ORDER.indexOf(quality);
        return requestedIndex <= maxQualityIndex;
      },
    };
  }, [profile?.subscription_tier, profile?.tier_expires_at]);
}
