-- Add DELETE policy for sessions table (needed for session termination)
CREATE POLICY "Service role can delete sessions"
ON public.sessions
FOR DELETE
USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text);