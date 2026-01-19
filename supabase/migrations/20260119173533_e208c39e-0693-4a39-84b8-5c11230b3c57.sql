-- Fix database functions to explicitly use SECURITY INVOKER

-- Recreate update_updated_at_column with explicit SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql 
SECURITY INVOKER
SET search_path = pg_catalog, public;

-- Recreate generate_session_code with explicit SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.generate_session_code()
RETURNS VARCHAR(8) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result VARCHAR(8) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || pg_catalog.substr(chars, 
      pg_catalog.floor(pg_catalog.random() * pg_catalog.length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public;