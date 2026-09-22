-- Chạy sau 001. Không xóa dữ liệu hiện có.
BEGIN;
ALTER TABLE care_records ADD COLUMN IF NOT EXISTS resident_status TEXT NOT NULL DEFAULT 'IN_FACILITY';
UPDATE care_records SET resident_status='IN_FACILITY' WHERE resident_status IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='care_records'::regclass AND conname='chk_care_records_resident_status') THEN
    ALTER TABLE care_records ADD CONSTRAINT chk_care_records_resident_status
      CHECK (resident_status IN ('IN_FACILITY','HOME_LEAVE','HOSPITAL'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS care_event_catalog (
  code TEXT PRIMARY KEY, name_vi TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO care_event_catalog(code,name_vi,display_order) VALUES
 ('OBSERVATION','Theo dõi chung',10),('FALL','Té ngã',20),('PAIN','Đau',30),
 ('MEAL','Ăn uống',40),('RESPIRATORY','Hô hấp',50),('SKIN','Da / vết thương',60),
 ('BEHAVIOR','Hành vi / tinh thần',70),('FAMILY','Liên hệ gia đình',80),('OTHER','Khác',90)
ON CONFLICT(code) DO NOTHING;
CREATE TABLE IF NOT EXISTS care_record_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  care_record_id TEXT NOT NULL REFERENCES care_records(id) ON DELETE CASCADE,
  event_code TEXT NOT NULL REFERENCES care_event_catalog(code) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_care_record_event UNIQUE(care_record_id,event_code)
);
CREATE INDEX IF NOT EXISTS idx_care_record_events_code ON care_record_events(event_code);
CREATE INDEX IF NOT EXISTS idx_care_records_resident_status ON care_records(resident_status,occurred_at DESC) WHERE deleted=FALSE;
INSERT INTO care_record_events(care_record_id,event_code)
SELECT id,CASE WHEN event_type='HOSPITAL' THEN 'OBSERVATION' ELSE event_type END
FROM care_records WHERE event_type IN ('HOSPITAL','OBSERVATION','FALL','PAIN','MEAL','RESPIRATORY','SKIN','BEHAVIOR','FAMILY','OTHER')
ON CONFLICT(care_record_id,event_code) DO NOTHING;
COMMIT;
