BEGIN;

-- Source of truth for account roles.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
CHECK (role IN ('ADMIN','BRANCH_DIRECTOR','CARE_SHARED'));

-- Old columns from earlier prototypes are no longer used.
ALTER TABLE users DROP COLUMN IF EXISTS full_access;
ALTER TABLE shifts DROP COLUMN IF EXISTS primary_recorder_staff_id;

-- Vitals used by current UI/reporting.
ALTER TABLE care_record_vitals
  ADD COLUMN IF NOT EXISTS blood_glucose NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS insulin_dose_units NUMERIC(8,2);

-- Preserve historical care data when a shift already has business records.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    WHERE tc.table_schema='public'
      AND tc.constraint_type='FOREIGN KEY'
      AND kcu.column_name='shift_id'
      AND tc.table_name IN ('care_records','toileting_logs','handovers')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', c.table_name, c.constraint_name);
  END LOOP;
END $$;

ALTER TABLE care_records
  ADD CONSTRAINT care_records_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT;

ALTER TABLE toileting_logs
  ADD CONSTRAINT toileting_logs_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT;

ALTER TABLE handovers
  ADD CONSTRAINT handovers_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_care_branch_time
  ON care_records(branch_id, occurred_at DESC)
  WHERE deleted=FALSE;

CREATE INDEX IF NOT EXISTS idx_toilet_branch_time
  ON toileting_logs(branch_id, created_at DESC)
  WHERE deleted=FALSE;

COMMIT;
