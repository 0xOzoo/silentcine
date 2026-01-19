-- Fix views to allow public access by removing security_invoker
-- The views already exclude sensitive columns (host_token, listener_token)
-- so they can safely use the view owner's permissions

-- Recreate sessions_public view WITHOUT security_invoker
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

-- Recreate session_listeners_public view WITHOUT security_invoker
DROP VIEW IF EXISTS public.session_listeners_public;

CREATE VIEW public.session_listeners_public AS
SELECT 
  id,
  session_id,
  connected_at,
  last_ping_at
FROM public.session_listeners;

-- Grant SELECT on the public view to all roles
GRANT SELECT ON public.session_listeners_public TO anon, authenticated;