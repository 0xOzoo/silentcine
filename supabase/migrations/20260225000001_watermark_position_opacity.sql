-- Migration: Add watermark position, opacity and size columns to profiles
-- ============================================================================

-- Position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS watermark_position TEXT DEFAULT 'top-right',
  ADD COLUMN IF NOT EXISTS watermark_opacity REAL DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS watermark_size REAL DEFAULT 1.0;
