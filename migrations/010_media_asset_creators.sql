ALTER TABLE media_assets ADD COLUMN created_by integer REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX media_assets_creator_idx ON media_assets(account_id,created_by,id DESC);
