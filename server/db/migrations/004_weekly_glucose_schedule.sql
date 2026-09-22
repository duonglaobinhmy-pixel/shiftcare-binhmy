-- Staff enable a seven-day reminder only after an individual care plan specifies it.
CREATE TABLE IF NOT EXISTS care_glucose_schedules (
  resident_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_days INTEGER NOT NULL DEFAULT 7 CHECK(interval_days BETWEEN 1 AND 365),
  next_due_date DATE NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_glucose_due ON care_glucose_schedules(branch_id, next_due_date) WHERE enabled;
