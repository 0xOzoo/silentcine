-- Create sessions table for hosts
CREATE TABLE public.sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(8) NOT NULL UNIQUE,
  host_id UUID,
  title VARCHAR(255) DEFAULT 'Untitled Session',
  audio_url TEXT,
  audio_filename VARCHAR(255),
  is_playing BOOLEAN NOT NULL DEFAULT false,
  current_time_ms BIGINT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Create listeners table to track connected listeners
CREATE TABLE public.session_listeners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  listener_token VARCHAR(64) NOT NULL,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_ping_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(session_id, listener_token)
);

-- Enable Row Level Security
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_listeners ENABLE ROW LEVEL SECURITY;

-- Sessions are publicly readable (anyone with the code can join)
CREATE POLICY "Sessions are publicly readable"
  ON public.sessions FOR SELECT
  USING (true);

-- Anyone can create a session (no auth required for simplicity)
CREATE POLICY "Anyone can create sessions"
  ON public.sessions FOR INSERT
  WITH CHECK (true);

-- Anyone can update sessions (for host control - in production, add host_token check)
CREATE POLICY "Anyone can update sessions"
  ON public.sessions FOR UPDATE
  USING (true);

-- Listeners are publicly readable
CREATE POLICY "Session listeners are publicly readable"
  ON public.session_listeners FOR SELECT
  USING (true);

-- Anyone can join as listener
CREATE POLICY "Anyone can join as listener"
  ON public.session_listeners FOR INSERT
  WITH CHECK (true);

-- Listeners can update their ping
CREATE POLICY "Listeners can update their ping"
  ON public.session_listeners FOR UPDATE
  USING (true);

-- Listeners can leave
CREATE POLICY "Listeners can leave"
  ON public.session_listeners FOR DELETE
  USING (true);

-- Enable realtime for sessions table (for sync)
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_listeners;

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to generate unique session code
CREATE OR REPLACE FUNCTION public.generate_session_code()
RETURNS VARCHAR(8) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result VARCHAR(8) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql SET search_path = public;