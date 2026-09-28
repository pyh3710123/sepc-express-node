ALTER TABLE users ADD COLUMN nickname text;
ALTER TABLE accounts ADD COLUMN watermark boolean NOT NULL DEFAULT false;

CREATE TABLE account_entitlements (
  account_id integer PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id integer,
  plan_title text NOT NULL DEFAULT '',
  vip_level integer NOT NULL DEFAULT 0,
  remove_watermark boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type integer NOT NULL CHECK (type IN (1,2)),
  account_id integer REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_user_id integer REFERENCES users(id) ON DELETE CASCADE,
  sub_type integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  intro text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  ext_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type=1 AND account_id IS NULL AND recipient_user_id IS NULL) OR
         (type=2 AND account_id IS NOT NULL))
);
CREATE INDEX notifications_scope_idx ON notifications(type,account_id,recipient_user_id,id DESC);
CREATE TABLE notification_reads (
  notification_id integer NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id,user_id)
);

CREATE TABLE articles (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  effective_at timestamptz,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
