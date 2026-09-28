CREATE TABLE opus_types (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO opus_types(name) VALUES ('短剧');

CREATE TABLE activities (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  status integer NOT NULL CHECK (status BETWEEN 0 AND 4),
  cover_image text NOT NULL DEFAULT '',
  head_image text NOT NULL DEFAULT '',
  detail_content text NOT NULL DEFAULT '',
  detail_url text NOT NULL DEFAULT '',
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  award_credit_total integer NOT NULL DEFAULT 0,
  award_money_total integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at>start_at)
);

CREATE TABLE activity_signups (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activity_id integer NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  account_id integer NOT NULL REFERENCES accounts(id),
  user_id integer NOT NULL REFERENCES users(id),
  entry_type integer NOT NULL CHECK (entry_type IN (1,2)),
  contact_mobile text NOT NULL,
  contact_email text NOT NULL,
  true_name text NOT NULL,
  speciality jsonb NOT NULL DEFAULT '[]'::jsonb,
  opus jsonb NOT NULL DEFAULT '[]'::jsonb,
  team_people integer,
  team_leader text,
  is_draft boolean NOT NULL DEFAULT true,
  check_status integer NOT NULL DEFAULT 0 CHECK (check_status IN (0,1,2)),
  check_reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id,account_id,user_id)
);

CREATE TABLE opuses (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  created_by integer NOT NULL REFERENCES users(id),
  drama_id integer NOT NULL REFERENCES dramas(id),
  canvas_id integer NOT NULL REFERENCES canvases(id),
  opus_name text NOT NULL,
  type_id integer NOT NULL REFERENCES opus_types(id),
  description text NOT NULL DEFAULT '',
  cover_asset_id integer NOT NULL REFERENCES media_assets(id),
  video_asset_id integer NOT NULL REFERENCES media_assets(id),
  activity_id integer REFERENCES activities(id),
  allow_clone boolean NOT NULL DEFAULT false,
  award_rank integer,
  view_count integer NOT NULL DEFAULT 0,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opuses_public_idx ON opuses(published_at DESC,id DESC);
CREATE INDEX opuses_owner_idx ON opuses(account_id,created_by,id DESC);
CREATE UNIQUE INDEX opuses_activity_entry_idx ON opuses(activity_id,account_id,created_by)
  WHERE activity_id IS NOT NULL;
CREATE TABLE opus_collections (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opus_id integer NOT NULL REFERENCES opuses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,opus_id)
);
