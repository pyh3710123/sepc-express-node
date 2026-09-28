CREATE TABLE camera_motions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer REFERENCES accounts(id) ON DELETE CASCADE,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  prompt_text text NOT NULL DEFAULT '',
  preview_image text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_id IS NULL) = (created_by IS NULL))
);
CREATE INDEX camera_motions_owner_idx ON camera_motions(account_id,created_by,id DESC);
CREATE TABLE camera_collections (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camera_id integer NOT NULL REFERENCES camera_motions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,camera_id)
);

CREATE TABLE prompt_templates (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_code text REFERENCES model_catalog(model_code) ON DELETE SET NULL,
  capability_id text REFERENCES model_capabilities(capability_id) ON DELETE SET NULL,
  prompt_type text NOT NULL,
  prompt_text text NOT NULL,
  resource_url text NOT NULL DEFAULT '',
  default_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_resource jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prompt_templates_type_idx ON prompt_templates(prompt_type,id DESC);

CREATE TABLE image_style_categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_recommend boolean NOT NULL DEFAULT false
);
CREATE TABLE image_styles (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id integer REFERENCES image_style_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  cover_image text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  can_commercial boolean NOT NULL DEFAULT false,
  is_recommend boolean NOT NULL DEFAULT false,
  support_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE image_style_collections (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  style_id integer NOT NULL REFERENCES image_styles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,style_id)
);
CREATE TABLE image_style_uses (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  style_id integer NOT NULL REFERENCES image_styles(id) ON DELETE CASCADE,
  use_count integer NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,style_id)
);

CREATE TABLE voice_catalog (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer REFERENCES accounts(id) ON DELETE CASCADE,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  voice_id text NOT NULL UNIQUE,
  voice_name text NOT NULL,
  voice_url text NOT NULL DEFAULT '',
  language text NOT NULL,
  accent integer,
  gender integer NOT NULL DEFAULT 0,
  age_group integer NOT NULL DEFAULT 3,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_id IS NULL) = (created_by IS NULL))
);
CREATE INDEX voice_catalog_owner_idx ON voice_catalog(account_id,created_by,id DESC);
CREATE TABLE voice_collections (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voice_id integer NOT NULL REFERENCES voice_catalog(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,voice_id)
);
