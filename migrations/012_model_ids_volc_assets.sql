ALTER TABLE model_catalog ADD COLUMN model_id integer GENERATED ALWAYS AS IDENTITY;
ALTER TABLE model_catalog ADD CONSTRAINT model_catalog_model_id_key UNIQUE (model_id);

CREATE TABLE volc_asset_records (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  media_asset_id integer NOT NULL REFERENCES media_assets(id),
  asset_type text NOT NULL CHECK (asset_type IN ('Image','Video','Audio')),
  volc_asset_id text,
  status text NOT NULL DEFAULT 'pending',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX volc_asset_records_account_idx ON volc_asset_records(account_id,id DESC);
