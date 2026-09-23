CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uuid uuid NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  mobile text UNIQUE,
  email text UNIQUE,
  password_hash text NOT NULL,
  avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('personal', 'team')),
  name text NOT NULL,
  owner_user_id integer NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_members (
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_sessions_user_idx ON refresh_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE sms_challenges (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mobile text NOT NULL,
  send_type text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_challenges_mobile_idx ON sms_challenges(mobile, send_type, created_at DESC);

CREATE TABLE dramas (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  created_by integer NOT NULL REFERENCES users(id),
  title text NOT NULL,
  type text NOT NULL DEFAULT 'drama',
  parent_id integer REFERENCES dramas(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dramas_account_idx ON dramas(account_id, id) WHERE deleted_at IS NULL;

CREATE TABLE canvases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  drama_id integer NOT NULL REFERENCES dramas(id) ON DELETE CASCADE,
  title text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvases_account_drama_idx ON canvases(account_id, drama_id);

CREATE TABLE canvas_viewports (
  canvas_id integer NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x double precision NOT NULL,
  y double precision NOT NULL,
  window_zoom_rate double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, user_id)
);

CREATE TABLE nodes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canvas_id integer NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  uuid text NOT NULL,
  type text NOT NULL,
  node_name text NOT NULL,
  position_x double precision NOT NULL,
  position_y double precision NOT NULL,
  width double precision,
  height double precision,
  parent_uuid text,
  z_index integer NOT NULL DEFAULT 0,
  content text,
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canvas_id, uuid)
);
CREATE INDEX nodes_canvas_id_idx ON nodes(canvas_id, id);

CREATE TABLE connections (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canvas_id integer NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  uuid text NOT NULL,
  source_uuid text NOT NULL,
  target_uuid text NOT NULL,
  source_anchor text,
  target_anchor text,
  type text,
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canvas_id, uuid)
);
CREATE INDEX connections_canvas_id_idx ON connections(canvas_id, id);

CREATE TABLE canvas_events (
  event_id uuid PRIMARY KEY,
  canvas_id integer NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  server_version integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canvas_id, server_version)
);

CREATE TABLE model_catalog (
  model_code text PRIMARY KEY,
  model_name text NOT NULL,
  model_type text NOT NULL,
  provider text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_capabilities (
  capability_id text PRIMARY KEY,
  model_code text NOT NULL REFERENCES model_catalog(model_code),
  node_type text NOT NULL,
  mode_type text NOT NULL,
  scene text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  model_revision integer NOT NULL DEFAULT 1,
  input_schema jsonb NOT NULL,
  parameters jsonb NOT NULL,
  features jsonb NOT NULL,
  price_credits integer NOT NULL CHECK (price_credits >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_code, node_type, mode_type)
);

CREATE TABLE credit_wallets (
  account_id integer PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  source_key text NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, source_key)
);
CREATE INDEX credit_ledger_account_idx ON credit_ledger(account_id, id DESC);

CREATE TABLE generation_requests (
  id uuid PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  endpoint text NOT NULL,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, endpoint, request_id)
);

CREATE TABLE generation_tasks (
  task_id uuid PRIMARY KEY,
  generation_request_id uuid NOT NULL REFERENCES generation_requests(id),
  task_index integer NOT NULL,
  account_id integer NOT NULL REFERENCES accounts(id),
  canvas_id integer REFERENCES canvases(id),
  node_id integer REFERENCES nodes(id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  progress integer NOT NULL DEFAULT 0,
  price_credits integer NOT NULL,
  payload jsonb NOT NULL,
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_request_id, task_index)
);
CREATE INDEX generation_tasks_account_idx ON generation_tasks(account_id, task_id);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events(created_at) WHERE delivered_at IS NULL;

CREATE TABLE media_assets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_byte bigint NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_account_idx ON media_assets(account_id, id);

CREATE TABLE orders (
  order_no text PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  order_type text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  pay_status integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_events (
  provider_event_id text PRIMARY KEY,
  order_no text NOT NULL REFERENCES orders(order_no),
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
