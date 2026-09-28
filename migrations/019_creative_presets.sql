CREATE TABLE image_scene_preset_categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false
);
CREATE TABLE image_scene_presets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id integer NOT NULL REFERENCES image_scene_preset_categories(id) ON DELETE CASCADE,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  allow_model jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allow_model)='array'),
  icon jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(icon)='object'),
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false
);
CREATE INDEX image_scene_presets_category_idx ON image_scene_presets(category_id,sort_order,id)
  WHERE published;

CREATE TABLE lighten_presets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  preset_name text NOT NULL,
  cover_image text NOT NULL DEFAULT '',
  show_prompt text NOT NULL DEFAULT '',
  reference_image text NOT NULL DEFAULT '',
  brightness numeric(5,2) CHECK (brightness>=0 AND brightness<=100),
  color_hex text CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  point_key text,
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false
);
CREATE INDEX lighten_presets_published_idx ON lighten_presets(sort_order,id) WHERE published;
