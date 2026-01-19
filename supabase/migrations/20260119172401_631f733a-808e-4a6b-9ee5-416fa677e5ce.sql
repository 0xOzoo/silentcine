-- Fix security definer view warning by setting security_invoker = true
-- This ensures the view runs with the permissions of the querying user

-- Recreate sessions_public view with security_invoker
DROP VIEW IF EXISTS public.sessions_public;

CREATE VIEW public.sessions_public 
WITH (security_invoker = true)
AS
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

-- Recreate session_listeners_public view with security_invoker
DROP VIEW IF EXISTS public.session_listeners_public;

CREATE VIEW public.session_listeners_public
WITH (security_invoker = true)
AS
SELECT 
  id,
  session_id,
  connected_at,
  last_ping_at
FROM public.session_listeners;

-- Grant SELECT on the public view to all roles
GRANT SELECT ON public.session_listeners_public TO anon, authenticated;