CREATE TABLE member_credit_allocations (
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_quota bigint NOT NULL DEFAULT -1 CHECK (credit_quota>=-1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id,user_id)
);
