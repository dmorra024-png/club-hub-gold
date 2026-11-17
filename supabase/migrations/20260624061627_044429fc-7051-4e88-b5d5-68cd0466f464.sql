
CREATE POLICY "auth read snoop-docs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'snoop-docs');
CREATE POLICY "auth insert snoop-docs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'snoop-docs');
CREATE POLICY "auth update snoop-docs" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'snoop-docs') WITH CHECK (bucket_id = 'snoop-docs');
CREATE POLICY "auth delete snoop-docs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'snoop-docs');
