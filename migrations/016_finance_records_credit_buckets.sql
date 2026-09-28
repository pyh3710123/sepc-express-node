ALTER TABLE credit_wallets ADD COLUMN subscription_balance integer NOT NULL DEFAULT 0;
ALTER TABLE credit_wallets ADD COLUMN recharge_balance integer NOT NULL DEFAULT 0;
ALTER TABLE credit_wallets ADD COLUMN gift_balance integer NOT NULL DEFAULT 0;
UPDATE credit_wallets SET gift_balance=balance;
ALTER TABLE credit_wallets ADD CONSTRAINT credit_wallets_bucket_sum_check
  CHECK (balance=subscription_balance+recharge_balance+gift_balance);
ALTER TABLE credit_ledger ADD COLUMN bucket_amounts jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE generation_tasks ADD COLUMN debit_buckets jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE generation_tasks SET debit_buckets=jsonb_build_object('gift',price_credits);

CREATE TABLE credit_priority_settings (
  account_id integer PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  priority integer[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (array_length(priority,1)=3)
);

ALTER TABLE account_entitlements ADD COLUMN storage_limit_bytes bigint;
ALTER TABLE orders ADD COLUMN id integer GENERATED ALWAYS AS IDENTITY;
ALTER TABLE orders ADD CONSTRAINT orders_id_key UNIQUE (id);
ALTER TABLE orders ADD COLUMN subject text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN channel text;
ALTER TABLE orders ADD COLUMN pay_cycle text;
ALTER TABLE orders ADD COLUMN paid_at timestamptz;
ALTER TABLE orders ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE invoices (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  status text NOT NULL CHECK (status IN ('processing','issued','cancelled')),
  invoice_type text NOT NULL CHECK (invoice_type IN ('personal','unit')),
  invoice_kind text NOT NULL CHECK (invoice_kind IN ('common','special')),
  title text NOT NULL,
  email text NOT NULL,
  tax_no text,
  file_url text,
  invoice_no text,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_account_idx ON invoices(account_id,id DESC);
CREATE TABLE invoice_orders (
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_no text NOT NULL UNIQUE REFERENCES orders(order_no),
  PRIMARY KEY (invoice_id,order_no)
);
