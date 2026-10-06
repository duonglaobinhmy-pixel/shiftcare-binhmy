-- V2 records are independently upserted. Legacy tables remain read-only to V2.
CREATE TABLE IF NOT EXISTS shiftcare_operations (
  branch_id text NOT NULL,
  kind text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, kind, id)
);
CREATE INDEX IF NOT EXISTS operations_shift ON shiftcare_operations(branch_id, kind, (payload->>'shiftId'));
CREATE INDEX IF NOT EXISTS operations_scope ON shiftcare_operations(branch_id, kind, (payload->>'scopeId'));
CREATE INDEX IF NOT EXISTS operations_resident ON shiftcare_operations(branch_id, kind, (payload->>'residentId'));
CREATE INDEX IF NOT EXISTS operations_date ON shiftcare_operations(branch_id, kind, (payload->>'businessDate'));
CREATE UNIQUE INDEX IF NOT EXISTS operations_one_shift ON shiftcare_operations(branch_id, (payload->>'businessDate'), (payload->>'shiftType')) WHERE kind='shifts';
CREATE UNIQUE INDEX IF NOT EXISTS operations_one_scope ON shiftcare_operations(branch_id, (payload->>'shiftId'), (payload->>'zoneId')) WHERE kind='scopes';
CREATE UNIQUE INDEX IF NOT EXISTS operations_request ON shiftcare_operations(branch_id, (payload->>'enteredByUserId'), (payload->>'clientRequestId')) WHERE kind='activities';
