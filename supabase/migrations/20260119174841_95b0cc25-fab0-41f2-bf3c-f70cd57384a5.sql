-- Create table for persistent rate limiting
CREATE TABLE public.rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint for upsert operations
CREATE UNIQUE INDEX rate_limits_key_idx ON public.rate_limits(key);

-- Create index for efficient cleanup queries
CREATE INDEX rate_limits_window_start_idx ON public.rate_limits(window_start);

-- Enable RLS
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can access rate limits table (edge functions use service role)
CREATE POLICY "Service role only"
  ON public.rate_limits
  FOR ALL
  USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
  WITH CHECK (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text);

-- Function to check and update rate limit (atomic operation)
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_record rate_limits%ROWTYPE;
  v_window_start TIMESTAMP WITH TIME ZONE;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::INTERVAL;
  
  -- Try to get existing record that's still within the window
  SELECT * INTO v_record
  FROM rate_limits
  WHERE key = p_key AND window_start > v_window_start
  FOR UPDATE;
  
  IF NOT FOUND THEN
    -- No valid record, delete old one if exists and create new
    DELETE FROM rate_limits WHERE key = p_key;
    INSERT INTO rate_limits (key, count, window_start)
    VALUES (p_key, 1, now());
    RETURN TRUE;
  END IF;
  
  -- Check if limit exceeded
  IF v_record.count >= p_max_requests THEN
    RETURN FALSE;
  END IF;
  
  -- Increment count
  UPDATE rate_limits
  SET count = count + 1
  WHERE id = v_record.id;
  
  RETURN TRUE;
END;
$$;

-- Function to clean up expired rate limit entries (call periodically)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Delete entries older than 5 minutes
  DELETE FROM rate_limits
  WHERE window_start < now() - INTERVAL '5 minutes';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;