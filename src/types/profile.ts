export type SubscriptionTier = 'free' | 'event' | 'pro' | 'enterprise';
export type RetentionPolicy = '7_days' | '30_days' | 'permanent';
export type QualityProfile = '720p' | '1080p' | '4k';
export type EventPassStatus = 'pending' | 'active' | 'used' | 'expired';
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface Profile {
  id: string;
  auth_user_id: string | null;
  anonymous_id: string | null;
  email: string | null;
  display_name: string | null;
  subscription_tier: SubscriptionTier;
  tier_expires_at: string | null;
  max_listeners: number;
  concurrent_movies_allowed: number;
  custom_branding_url: string | null;
  watermark_text: string | null;
  watermark_image_url: string | null;
  watermark_position: WatermarkPosition;
  watermark_opacity: number;
  watermark_size: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  anonymous: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventPass {
  id: string;
  profile_id: string;
  purchase_date: string;
  stripe_payment_id: string | null;
  activation_date: string | null;
  expires_at: string | null;
  max_activation_date: string;
  status: EventPassStatus;
  created_at: string;
  updated_at: string;
}

/** Tier limits for display purposes */
export const TIER_LIMITS: Record<SubscriptionTier, {
  label: string;
  maxListeners: number;
  concurrentMovies: number;
  maxQuality: QualityProfile;
  retention: RetentionPolicy;
  branding: 'silentcine' | 'custom' | 'white_label';
  storageGb: number;
}> = {
  free: {
    label: 'Free',
    maxListeners: 5,
    concurrentMovies: 1,
    maxQuality: '720p',
    retention: '7_days',
    branding: 'silentcine',
    storageGb: 2.5,
  },
  event: {
    label: 'Event Pass',
    maxListeners: 50,
    concurrentMovies: 3,
    maxQuality: '1080p',
    retention: '30_days',
    branding: 'silentcine',
    storageGb: 50,
  },
  pro: {
    label: 'Pro',
    maxListeners: 100,
    concurrentMovies: 5,
    maxQuality: '1080p',
    retention: 'permanent',
    branding: 'custom',
    storageGb: 100,
  },
  enterprise: {
    label: 'Enterprise',
    maxListeners: -1, // unlimited
    concurrentMovies: -1, // unlimited
    maxQuality: '4k',
    retention: 'permanent',
    branding: 'white_label',
    storageGb: 1000,
  },
};
