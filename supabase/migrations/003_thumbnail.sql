-- Add thumbnail_url column for watcher-generated base64 JPEG thumbnails
ALTER TABLE clips ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
