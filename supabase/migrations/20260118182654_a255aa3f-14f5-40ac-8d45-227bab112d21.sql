-- Add columns to store available audio and subtitle tracks from the video
ALTER TABLE public.sessions 
ADD COLUMN audio_tracks jsonb DEFAULT '[]'::jsonb,
ADD COLUMN subtitle_tracks jsonb DEFAULT '[]'::jsonb,
ADD COLUMN selected_audio_track integer DEFAULT 0,
ADD COLUMN selected_subtitle_track integer DEFAULT -1,
ADD COLUMN video_url text;