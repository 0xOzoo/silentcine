-- Make the audio-files bucket private
UPDATE storage.buckets SET public = false WHERE id = 'audio-files';

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Anyone can upload audio files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete audio files" ON storage.objects;
DROP POLICY IF EXISTS "Audio files are publicly accessible" ON storage.objects;

-- Create restrictive policy - only allow access via service role (edge functions)
-- No direct client access - all operations go through edge functions
CREATE POLICY "Service role only access"
  ON storage.objects FOR ALL
  USING (bucket_id = 'audio-files' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'audio-files' AND auth.role() = 'service_role');