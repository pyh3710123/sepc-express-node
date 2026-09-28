CREATE TABLE materials (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  created_by integer NOT NULL REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('role','scene','item','prop','audio','text','other')),
  mime_type text NOT NULL,
  material_name text NOT NULL,
  content text NOT NULL,
  cover_image text NOT NULL DEFAULT '',
  node_id integer REFERENCES nodes(id) ON DELETE SET NULL,
  node_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX materials_account_idx ON materials(account_id,id DESC);

CREATE TABLE subject_timbres (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  created_by integer NOT NULL REFERENCES users(id),
  timbre_name text NOT NULL,
  audio_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subject_timbres_account_idx ON subject_timbres(account_id,id DESC);

CREATE TABLE subjects (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  created_by integer NOT NULL REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('character','scene','prop','effects','other')),
  subject_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  content jsonb NOT NULL,
  timbre_id integer REFERENCES subject_timbres(id) ON DELETE SET NULL,
  is_image boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subjects_account_idx ON subjects(account_id,id DESC);

CREATE TABLE canvas_library_nodes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  created_by integer NOT NULL REFERENCES users(id),
  parent_node_id integer REFERENCES nodes(id) ON DELETE SET NULL,
  title text NOT NULL,
  remark text NOT NULL DEFAULT '',
  cover_image text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  category text NOT NULL CHECK (category IN ('video','image','audio','text','other')),
  node_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_library_nodes_account_idx ON canvas_library_nodes(account_id,id DESC);
