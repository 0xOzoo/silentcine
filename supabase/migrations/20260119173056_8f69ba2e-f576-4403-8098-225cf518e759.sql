-- SECURITY FIX: Remove the overly permissive SELECT policy that exposes host_token
-- Instead, we'll use polling from the public view for listeners

DROP POLICY IF EXISTS "Allow realtime select for sessions" ON public.sessions;
DROP POLICY IF EXISTS "Allow realtime select for session_listeners" ON public.session_listeners;

-- The existing restrictive policies are correct:
-- - "Only service role can read sessions" restricts to service_role
-- - "Users can only read own listener record" restricts by listener_token

-- For listeners to get session updates, they should poll the sessions_public view
-- or use the session-manager edge function to get updates

-- Add realtime for session_listeners only (since it can work with view)
-- Actually, realtime requires direct table access, so we need a different approach

-- Let's enable RLS bypass for realtime subscriptions by keeping tables in realtime
-- but listeners will poll via edge function for session state