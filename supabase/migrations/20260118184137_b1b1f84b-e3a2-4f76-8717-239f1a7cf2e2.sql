-- Create a public view for session_listeners that hides the token
CREATE VIEW public.session_listeners_public
WITH (security_invoker=on) AS
  SELECT id, session_id, connected_at, last_ping_at
  FROM public.session_listeners;
  -- Excludes listener_token for security

-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Session listeners are publicly readable" ON public.session_listeners;

-- Create restrictive SELECT policy - only allow users to see their own record
-- For anonymous apps, we verify via the listener_token passed in request
CREATE POLICY "Users can only read own listener record"
  ON public.session_listeners FOR SELECT
  USING (
    listener_token = current_setting('request.headers', true)::json->>'x-listener-token'
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );

-- Grant SELECT on the view for public access to non-sensitive data
GRANT SELECT ON public.session_listeners_public TO anon, authenticated;