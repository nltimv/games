-- Usage data from the hub and the games (server/telemetry.js). One row per
-- event. The ids are random ids made by the browser: install_id per device
-- (or browser), session_id per visit, save_id per Driftworks save on that
-- device. None of them is linked to a save code. No IP address is stored.
-- Rows older than TELEMETRY_RETENTION_DAYS are deleted.
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  at timestamptz NOT NULL,
  game text NOT NULL,
  name text NOT NULL,
  install_id uuid NOT NULL,
  save_id uuid,
  session_id uuid NOT NULL,
  version text,
  platform text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX events_game_name_at_idx ON events (game, name, at);
CREATE INDEX events_at_idx ON events (at);
CREATE INDEX events_save_idx ON events (save_id, at) WHERE save_id IS NOT NULL;
CREATE INDEX events_install_idx ON events (install_id, at);
