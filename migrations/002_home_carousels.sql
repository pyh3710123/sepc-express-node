CREATE TABLE home_carousels (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  image_url text NOT NULL CHECK (length(image_url) <= 2048 AND image_url ~* '^https?://'),
  link_url text CHECK (link_url IS NULL OR (length(link_url) <= 2048 AND (link_url = '/' OR link_url ~* '^(https?://|/[^/])'))),
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX home_carousels_published_idx ON home_carousels(sort_order, id) WHERE published;
