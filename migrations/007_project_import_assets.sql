-- 同一底层对象可以分别登记给个人和团队账号，导入不移动原始登记。
ALTER TABLE media_assets DROP CONSTRAINT media_assets_object_key_key;
ALTER TABLE media_assets ADD COLUMN origin_asset_id integer REFERENCES media_assets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX media_assets_account_object_idx ON media_assets(account_id,object_key);
