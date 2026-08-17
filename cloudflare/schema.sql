CREATE TABLE IF NOT EXISTS fast_data (
  account_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
