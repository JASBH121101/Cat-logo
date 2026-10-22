-- Cat-logo: add the selected variant metadata to catalog analytics.
-- Run this in the SQL Editor of the Supabase project connected to Cat-logo.
-- This adds columns only; existing events and RLS policies are preserved.

BEGIN;

ALTER TABLE public.catalog_events
  ADD COLUMN IF NOT EXISTS variant_color text,
  ADD COLUMN IF NOT EXISTS variant_ram text,
  ADD COLUMN IF NOT EXISTS variant_storage text;

CREATE INDEX IF NOT EXISTS catalog_events_variant_interest_idx
  ON public.catalog_events (
    event_type,
    variant_storage,
    variant_ram,
    variant_color,
    created_at DESC
  )
  WHERE event_type = 'whatsapp_click';

COMMIT;
