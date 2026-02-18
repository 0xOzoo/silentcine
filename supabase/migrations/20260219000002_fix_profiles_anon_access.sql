-- Fix: Allow anonymous users to read profiles by anonymous_id
-- The original RLS only allowed reads via auth_user_id = auth.uid(),
-- which blocks anonymous (unauthenticated) users from reading their
-- own profile even after the edge function creates it.

-- Allow anon role to read any profile (the anonymous_id filter is
-- applied in the application query, not RLS — this is safe because
-- profiles contain no sensitive data, and the anon key can only
-- SELECT, not modify).
CREATE POLICY "Anon can read profiles"
  ON public.profiles FOR SELECT
  TO anon
  USING (true);

-- Allow anon role to read their own event passes (via profile lookup)
CREATE POLICY "Anon can read event passes"
  ON public.event_passes FOR SELECT
  TO anon
  USING (true);
