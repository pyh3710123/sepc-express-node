CREATE TABLE plan_catalog (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_type text NOT NULL CHECK (account_type IN ('personal','team')),
  plan_title text NOT NULL,
  level integer NOT NULL CHECK (level>0),
  pay_cycle text NOT NULL CHECK (pay_cycle IN ('monthly','yearly')),
  price_cents integer NOT NULL CHECK (price_cents>=0),
  included_seats integer NOT NULL DEFAULT 1 CHECK (included_seats>0),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE credit_pricing (
  id integer PRIMARY KEY CHECK (id=1),
  min_credit integer NOT NULL CHECK (min_credit>0),
  max_credit integer NOT NULL CHECK (max_credit>=min_credit),
  step_credit integer NOT NULL CHECK (step_credit>0),
  credits_per_yuan integer NOT NULL CHECK (credits_per_yuan>0)
);
CREATE TABLE credit_price_presets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label text NOT NULL,
  credit_value integer NOT NULL CHECK (credit_value>0),
  total_credit integer NOT NULL CHECK (total_credit>=credit_value),
  price_cents integer NOT NULL CHECK (price_cents>=0),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE space_price_plans (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type integer NOT NULL CHECK (type IN (1,2,3)),
  discount numeric(4,2) NOT NULL DEFAULT 0,
  min_limit integer NOT NULL CHECK (min_limit>0),
  max_limit integer NOT NULL CHECK (max_limit>=min_limit),
  origin_price_cents integer NOT NULL CHECK (origin_price_cents>=0),
  price_cents integer NOT NULL CHECK (price_cents>=0),
  active boolean NOT NULL DEFAULT true
);
