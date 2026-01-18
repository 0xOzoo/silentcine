-- Drop the overly permissive policies on session_listeners
DROP POLICY IF EXISTS "Anyone can join as listener" ON public.session_listeners;
DROP POLICY IF EXISTS "Listeners can leave" ON public.session_listeners;
DROP POLICY IF EXISTS "Listeners can update their ping" ON public.session_listeners;

-- Create a function to validate listener token from request header
CREATE OR REPLACE FUNCTION public.get_listener_token()
RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.headers', true)::json->>'x-listener-token',
    ''
  );
END;
$$ LANGUAGE plpgsql 
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public;

-- INSERT: Allow joining if session exists (validated by FK constraint)
-- The listener_token must match what the client provides
CREATE POLICY "Listeners can join with valid token"
  ON public.session_listeners FOR INSERT
  WITH CHECK (
    -- Validate session exists (FK handles this)
    -- Token is provided in the insert and stored
    listener_token IS NOT NULL AND length(listener_token) > 0
  );

-- UPDATE: Only allow updating own record (matched by listener_token)
CREATE POLICY "Listeners can update own ping"
  ON public.session_listeners FOR UPDATE
  USING (
    listener_token = public.get_listener_token()
  );

-- DELETE: Only allow deleting own record (matched by listener_token)
CREATE POLICY "Listeners can leave own session"
  ON public.session_listeners FOR DELETE
  USING (
    listener_token = public.get_listener_token()
  );