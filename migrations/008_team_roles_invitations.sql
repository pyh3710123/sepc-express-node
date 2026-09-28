CREATE TABLE account_roles (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role_name text NOT NULL,
  system_role text NOT NULL CHECK (system_role IN ('admin','member','custom')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id,role_name)
);

-- custom 可以有多个，内置管理员和成员角色各一条。
CREATE UNIQUE INDEX account_roles_system_idx ON account_roles(account_id,system_role)
  WHERE system_role IN ('admin','member');

INSERT INTO account_roles(account_id,role_name,system_role)
SELECT id,'管理员','admin' FROM accounts WHERE type='team';
INSERT INTO account_roles(account_id,role_name,system_role)
SELECT id,'成员','member' FROM accounts WHERE type='team';

ALTER TABLE account_members ADD COLUMN role_id integer REFERENCES account_roles(id) ON DELETE SET NULL;
UPDATE account_members m SET role_id=r.id FROM account_roles r
WHERE r.account_id=m.account_id AND r.system_role=CASE WHEN m.role='admin' THEN 'admin' ELSE 'member' END;
UPDATE account_members SET role_id=NULL WHERE role='owner';

CREATE TABLE account_invitations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_user_id integer NOT NULL REFERENCES users(id),
  inviter_user_id integer NOT NULL REFERENCES users(id),
  role_id integer REFERENCES account_roles(id) ON DELETE SET NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  kind text NOT NULL DEFAULT 'invitation' CHECK (kind IN ('invitation','application')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX account_invitations_pending_idx ON account_invitations(account_id,target_user_id)
  WHERE status='pending';
CREATE INDEX account_invitations_target_idx ON account_invitations(target_user_id,status,id DESC);
