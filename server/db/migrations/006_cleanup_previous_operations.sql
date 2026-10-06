BEGIN;
-- Retire the parallel prototype store while retaining every existing record.
DO $$
BEGIN
  IF to_regclass('public.shiftcare_operations') IS NOT NULL THEN
    CREATE SCHEMA IF NOT EXISTS shiftcare_archive;
    IF to_regclass('shiftcare_archive.shiftcare_operations') IS NOT NULL THEN
      RAISE EXCEPTION 'Archive already exists; inspect both tables before cleanup';
    END IF;
    ALTER TABLE public.shiftcare_operations SET SCHEMA shiftcare_archive;
  END IF;
END $$;
-- Rebuild only derived alert fields using the existing application rules.
-- Do not infer performers for historical shared-account records.
WITH levels AS (
  SELECT c.id,
    CASE WHEN v.alert_level='RED' OR c.event_type='FALL' OR c.priority='HIGH'
      OR EXISTS(SELECT 1 FROM care_record_categories cat WHERE cat.care_record_id=c.id AND cat.category_code='INCIDENT')
      OR COALESCE(c.legacy_extra->'categoryCodes','[]'::jsonb) ? 'INCIDENT' THEN 'RED'
    WHEN v.alert_level='YELLOW' OR c.priority='MEDIUM' THEN 'YELLOW'
    ELSE NULL END AS level
  FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id
)
UPDATE care_records c SET attention_level=l.level,
  attention_status=CASE WHEN l.level IS NULL THEN NULL WHEN c.attention_status='RESOLVED' THEN 'RESOLVED' ELSE 'OPEN' END
FROM levels l WHERE l.id=c.id;
-- Filters already used by the existing report screens.
CREATE INDEX IF NOT EXISTS idx_shift_staff_staff_shift ON shift_staff(staff_id, shift_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_date ON shifts(branch_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_care_resident_time ON care_records(branch_id, bcare_resident_id, occurred_at DESC) WHERE deleted=FALSE;
COMMIT;
