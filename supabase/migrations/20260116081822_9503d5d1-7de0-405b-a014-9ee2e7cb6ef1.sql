-- Create storage bucket for audio files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('audio-files', 'audio-files', true);

-- Allow public read access to audio files
CREATE POLICY "Audio files are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'audio-files');

-- Anyone can upload audio files
CREATE POLICY "Anyone can upload audio files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'audio-files');

-- Anyone can delete their uploaded audio files
CREATE POLICY "Anyone can delete audio files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'audio-files');