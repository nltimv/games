-- Accounts are anonymous: the account number and the optional recovery
-- email are stored only as keyed hashes (HMAC-SHA256 with the server pepper).
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  number_hash bytea NOT NULL UNIQUE,
  email_hash bytea UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Session tokens are stored as SHA-256 of the cookie value.
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- One save per account and game. The revision goes up by one on every
-- write; a write must name the revision it builds on.
CREATE TABLE saves (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  game text NOT NULL,
  revision integer NOT NULL,
  data jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  device text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, game)
);
