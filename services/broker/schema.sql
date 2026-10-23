CREATE TABLE IF NOT EXISTS broker_records (
  key text PRIMARY KEY,
  owner text NOT NULL,
  expires_at bigint NOT NULL,
  payload text NOT NULL
);
CREATE INDEX IF NOT EXISTS broker_records_owner ON broker_records (owner);
CREATE INDEX IF NOT EXISTS broker_records_expiry ON broker_records (expires_at);
