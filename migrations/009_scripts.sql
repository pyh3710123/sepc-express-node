ALTER TABLE scripts ADD COLUMN input_text text NOT NULL DEFAULT '';
ALTER TABLE scripts ADD COLUMN attr_ids integer[] NOT NULL DEFAULT '{}';
ALTER TABLE scripts ADD COLUMN model_code text NOT NULL DEFAULT '';
ALTER TABLE scripts ADD COLUMN status text NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','creating','finished'));
ALTER TABLE scripts ADD COLUMN current_step integer NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 7);
ALTER TABLE scripts ADD COLUMN episode_count integer NOT NULL DEFAULT 8 CHECK (episode_count BETWEEN 1 AND 100);
ALTER TABLE scripts ADD COLUMN episode_duration integer NOT NULL DEFAULT 2 CHECK (episode_duration BETWEEN 1 AND 120);
ALTER TABLE scripts ADD COLUMN revision integer NOT NULL DEFAULT 1;

CREATE TABLE script_episodes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  script_id integer NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  episode_num integer NOT NULL CHECK (episode_num > 0),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','processing','finished','failed')),
  has_confirmed boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (script_id,episode_num)
);

CREATE TABLE script_steps (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  script_id integer NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  step integer NOT NULL CHECK (step BETWEEN 1 AND 7),
  episode_id integer REFERENCES script_episodes(id) ON DELETE CASCADE,
  step_name text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','processing','finished','failed')),
  content text NOT NULL DEFAULT '',
  has_confirmed boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX script_steps_unique_idx ON script_steps(script_id,step,COALESCE(episode_id,0));
CREATE INDEX script_steps_script_idx ON script_steps(script_id,step,id);
