ALTER TABLE accounts ADD COLUMN intro text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN dissolved_at timestamptz;
ALTER TABLE generation_tasks ADD COLUMN created_by integer REFERENCES users(id);

CREATE TABLE account_permission_settings (
  account_id integer PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  can_create boolean NOT NULL DEFAULT true,
  assets_share boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- project_type 目前支持短剧和剧本，资源存在性由写入事务校验。
CREATE TABLE project_permissions (
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_type text NOT NULL CHECK (project_type IN ('drama', 'script')),
  project_id integer NOT NULL CHECK (project_id > 0),
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code text NOT NULL CHECK (permission_code IN ('editor', 'viewer', 'none')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, project_type, project_id, user_id)
);
CREATE INDEX project_permissions_user_idx ON project_permissions(user_id, account_id, project_type, project_id);

CREATE TABLE scripts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  created_by integer NOT NULL REFERENCES users(id),
  title text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scripts_account_idx ON scripts(account_id, id) WHERE deleted_at IS NULL;
