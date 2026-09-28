CREATE TABLE public_media_assets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (split_part(mime_type,'/',1) IN ('image','video','audio')),
  url text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  size_byte bigint NOT NULL CHECK (size_byte>0),
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_media_assets_published_idx ON public_media_assets(created_at DESC,id DESC)
  WHERE published;
