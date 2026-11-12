-- One row per cloud save. A save is reached with its save code, which is
-- stored only as a keyed hash (HMAC-SHA256 with the server pepper), like the
-- optional recovery email. A new save starts empty at revision 0; the
-- revision goes up by one on every write, and a write must name the
-- revision it builds on.
CREATE TABLE saves (
  id uuid PRIMARY KEY,
  game text NOT NULL,
  code_hash bytea NOT NULL UNIQUE,
  email_hash bytea,
  revision integer NOT NULL DEFAULT 0,
  data jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  device text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One email can recover several saves.
CREATE INDEX saves_email_idx ON saves (email_hash) WHERE email_hash IS NOT NULL;
