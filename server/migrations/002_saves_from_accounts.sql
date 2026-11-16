-- Upgrades a database made by the first cloud save version, which had
-- accounts and sessions. That version's schema was also numbered 001, so a
-- database that ran it never got 001's `saves` table and fails with
-- `column "id" of relation "saves" does not exist`. On any other database
-- this does nothing.
--
-- Old saves were reached with an account number hashed under a different
-- key than save codes, so that number cannot become a save code. A save
-- whose account had a recovery email keeps it (emails are hashed the same
-- way), with an unguessable placeholder code: email recovery hands out a
-- new code for it. Saves without an email could never be reached again
-- and are dropped.
DO $$
BEGIN
  IF to_regclass('accounts') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE saves_new (
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

  INSERT INTO saves_new (id, game, code_hash, email_hash, revision, data, summary, device, created_at, updated_at)
  SELECT gen_random_uuid(), s.game, sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')),
         a.email_hash, s.revision, s.data, s.summary, s.device, a.created_at, s.updated_at
  FROM saves s
  JOIN accounts a ON a.id = s.account_id
  WHERE a.email_hash IS NOT NULL;

  DROP TABLE saves, sessions, accounts;

  ALTER TABLE saves_new RENAME TO saves;
  ALTER TABLE saves RENAME CONSTRAINT saves_new_pkey TO saves_pkey;
  ALTER TABLE saves RENAME CONSTRAINT saves_new_code_hash_key TO saves_code_hash_key;
  CREATE INDEX saves_email_idx ON saves (email_hash) WHERE email_hash IS NOT NULL;
END
$$;
