-- Add host_token column for session authorization
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS host_token TEXT;

-- Create index for efficient token lookups
CREATE INDEX IF NOT EXISTS idx_sessions_host_token ON public.sessions(host_token);

-- Add constraint to ensure session codes are alphanumeric only (prevent XSS)
ALTER TABLE public.sessions ADD CONSTRAINT code_format CHECK (code ~ '^[A-Z0-9]{1,10}$');

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Anyone can update sessions" ON public.sessions;
DROP POLICY IF EXISTS "Anyone can create sessions" ON public.sessions;

-- Sessions are publicly readable (needed for listeners to join)
-- But the SELECT policy already exists, so we keep it

-- Only allow session creation via service role (edge function)
CREATE POLICY "Service role can create sessions"
  ON public.sessions FOR INSERT
  WITH CHECK (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );

-- Only allow updates via service role (edge function validates host token)
CREATE POLICY "Service role can update sessions"
  ON public.sessions FOR UPDATE
  USING (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );

-- Create a public view for sessions that hides the host_token
CREATE OR REPLACE VIEW public.sessions_public
WITH (security_invoker=on) AS
  SELECT id, code, title, audio_url, audio_filename, video_url, 
         is_playing, current_time_ms, last_sync_at, created_at, 
         updated_at, expires_at, audio_tracks, subtitle_tracks,
         selected_audio_track, selected_subtitle_track, host_id
  FROM public.sessions;
  -- Excludes host_token for security

-- Grant SELECT on the public view
GRANT SELECT ON public.sessions_public TO anon, authenticated;