-- Remove direct SELECT access to sessions table, force use of sessions_public view
-- Drop the existing permissive SELECT policy
DROP POLICY IF EXISTS "Sessions are publicly readable" ON public.sessions;

-- Create new SELECT policy that only allows service_role to read full session data
CREATE POLICY "Only service role can read sessions"
ON public.sessions
FOR SELECT
TO authenticated, anon
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- Drop and recreate the view to ensure it excludes host_token
DROP VIEW IF EXISTS public.sessions_public;

CREATE VIEW public.sessions_public AS
SELECT 
  id,
  code,
  title,
  host_id,
  audio_url,
  audio_filename,
  video_url,
  audio_tracks,
  subtitle_tracks,
  selected_audio_track,
  selected_subtitle_track,
  current_time_ms,
  is_playing,
  last_sync_at,
  created_at,
  updated_at,
  expires_at
FROM public.sessions;

-- Grant SELECT on the public view to all roles
GRANT SELECT ON public.sessions_public TO anon, authenticated;