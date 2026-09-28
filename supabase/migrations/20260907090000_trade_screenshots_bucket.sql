-- Private bucket for trade screenshots. Objects are keyed as
-- "<user_id>/<trade_id>/<filename>" so RLS can scope access per-owner using
-- the first path segment, matching the owner-scoping pattern already used
-- for every table in this schema.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trade-screenshots',
  'trade-screenshots',
  false,
  10485760, -- 10MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can manage their own trade screenshots" ON storage.objects;
CREATE POLICY "Users can manage their own trade screenshots"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'trade-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'trade-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
