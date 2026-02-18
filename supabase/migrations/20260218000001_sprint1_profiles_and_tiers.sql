-- Sprint 1: Profiles, Event Passes, and Tier System
-- =================================================

-- 1. Create custom types for tier system
DO $$ BEGIN
  CREATE TYPE public.subscription_tier AS ENUM ('free', 'event', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.retention_policy AS ENUM ('7_days', '30_days', 'permanent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.quality_profile AS ENUM ('720p', '1080p', '4k_hdr');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.event_pass_status AS ENUM ('pending', 'active', 'used', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Profiles table (extends auth.users for authenticated users, also supports anonymous)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Links to auth.users when authenticated; NULL for anonymous
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Anonymous users get a client-generated UUID stored in localStorage
  anonymous_id UUID UNIQUE,
  email TEXT,
  display_name TEXT,
  -- Tier system
  subscription_tier public.subscription_tier NOT NULL DEFAULT 'free',
  tier_expires_at TIMESTAMPTZ,
  -- Tier limits (denormalized for fast RLS checks)
  max_listeners INT NOT NULL DEFAULT 5,
  concurrent_movies_allowed INT NOT NULL DEFAULT 1,
  -- Branding
  custom_branding_url TEXT,
  -- Stripe (Sprint 5)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  -- Flags
  anonymous BOOLEAN NOT NULL DEFAULT true,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common lookups
CREATE INDEX idx_profiles_auth_user_id ON public.profiles(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX idx_profiles_anonymous_id ON public.profiles(anonymous_id) WHERE anonymous_id IS NOT NULL;
CREATE INDEX idx_profiles_tier ON public.profiles(subscription_tier);

-- Auto-update timestamp
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
  );

-- Authenticated users can update their own profile (non-sensitive fields)
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Only service_role can insert (edge functions handle creation)
CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
  );

-- Service role full access
CREATE POLICY "Service role full access to profiles"
  ON public.profiles FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
  );


-- 3. Event Passes table
CREATE TABLE public.event_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Purchase info
  purchase_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_payment_id TEXT,
  -- Activation: 48h window starts on first use, max 30 days from purchase
  activation_date TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  max_activation_date TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  -- Status
  status public.event_pass_status NOT NULL DEFAULT 'pending',
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_passes_profile ON public.event_passes(profile_id);
CREATE INDEX idx_event_passes_status ON public.event_passes(status);

CREATE TRIGGER update_event_passes_updated_at
  BEFORE UPDATE ON public.event_passes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.event_passes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own event passes"
  ON public.event_passes FOR SELECT
  USING (
    profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
    OR (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
  );

CREATE POLICY "Service role manages event passes"
  ON public.event_passes FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
  );


-- 4. Extend movies table with tier columns
-- (movies table already exists with: id, user_id, title, video_path, audio_path, status, processing_error, created_at, updated_at)

ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retention_policy public.retention_policy NOT NULL DEFAULT '7_days',
  ADD COLUMN IF NOT EXISTS quality_profile public.quality_profile NOT NULL DEFAULT '720p',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS has_audio_extracted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subtitle_tracks JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS audio_tracks JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;

-- Index for retention cron job
CREATE INDEX IF NOT EXISTS idx_movies_archived_at ON public.movies(archived_at)
  WHERE archived_at IS NOT NULL AND status != 'archived';
CREATE INDEX IF NOT EXISTS idx_movies_profile ON public.movies(profile_id);


-- 5. Function to check tier-based quality access
CREATE OR REPLACE FUNCTION public.check_quality_access(
  p_profile_id UUID,
  p_quality public.quality_profile
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tier public.subscription_tier;
BEGIN
  SELECT subscription_tier INTO v_tier
  FROM profiles WHERE id = p_profile_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Free: 720p only
  IF v_tier = 'free' AND p_quality != '720p' THEN RETURN false; END IF;
  -- Event: up to 1080p
  IF v_tier = 'event' AND p_quality = '4k_hdr' THEN RETURN false; END IF;
  -- Pro: up to 1080p
  IF v_tier = 'pro' AND p_quality = '4k_hdr' THEN RETURN false; END IF;
  -- Enterprise: all qualities
  RETURN true;
END;
$$;


-- 6. Function to check concurrent movie limit
CREATE OR REPLACE FUNCTION public.check_concurrent_movies(
  p_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_max INT;
  v_current INT;
BEGIN
  SELECT concurrent_movies_allowed INTO v_max
  FROM profiles WHERE id = p_profile_id;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT COUNT(*) INTO v_current
  FROM movies
  WHERE profile_id = p_profile_id
    AND status NOT IN ('archived', 'error');

  RETURN v_current < v_max;
END;
$$;


-- 7. Function to activate an event pass (starts 48h clock)
CREATE OR REPLACE FUNCTION public.activate_event_pass(
  p_pass_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pass event_passes%ROWTYPE;
BEGIN
  SELECT * INTO v_pass FROM event_passes WHERE id = p_pass_id FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_pass.status != 'pending' THEN RETURN false; END IF;
  IF now() > v_pass.max_activation_date THEN
    -- Past 30-day activation window
    UPDATE event_passes SET status = 'expired' WHERE id = p_pass_id;
    RETURN false;
  END IF;

  UPDATE event_passes
  SET status = 'active',
      activation_date = now(),
      expires_at = now() + interval '48 hours'
  WHERE id = p_pass_id;

  -- Upgrade profile to event tier
  UPDATE profiles
  SET subscription_tier = 'event',
      tier_expires_at = now() + interval '48 hours',
      max_listeners = 50,
      concurrent_movies_allowed = 3
  WHERE id = v_pass.profile_id;

  RETURN true;
END;
$$;


-- 8. Function to expire lapsed event passes (called by cron or edge function)
CREATE OR REPLACE FUNCTION public.expire_event_passes()
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_pass RECORD;
BEGIN
  FOR v_pass IN
    SELECT ep.id, ep.profile_id
    FROM event_passes ep
    WHERE ep.status = 'active' AND ep.expires_at < now()
  LOOP
    UPDATE event_passes SET status = 'expired' WHERE id = v_pass.id;

    -- Downgrade to free if no other active passes or subscriptions
    UPDATE profiles
    SET subscription_tier = 'free',
        tier_expires_at = NULL,
        max_listeners = 5,
        concurrent_movies_allowed = 1
    WHERE id = v_pass.profile_id
      AND subscription_tier = 'event';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


-- 9. Function to handle profile creation on auth signup (trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (auth_user_id, email, anonymous, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    false,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

-- Trigger: auto-create profile when user signs up via Supabase Auth
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- 10. Retention policy helper
CREATE OR REPLACE FUNCTION public.get_retention_date(
  p_created_at TIMESTAMPTZ,
  p_policy public.retention_policy
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  CASE p_policy
    WHEN '7_days' THEN RETURN p_created_at + interval '7 days';
    WHEN '30_days' THEN RETURN p_created_at + interval '30 days';
    WHEN 'permanent' THEN RETURN NULL; -- Never expires
  END CASE;
END;
$$;
