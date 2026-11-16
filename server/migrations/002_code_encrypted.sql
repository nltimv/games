-- The save code, encrypted (AES-256-GCM, key derived from the server
-- pepper), so email recovery can mail a save's existing code instead of
-- replacing it. Lookups still go through code_hash. Saves made before this
-- get it the next time their code is used.
ALTER TABLE saves ADD COLUMN code_enc bytea;
