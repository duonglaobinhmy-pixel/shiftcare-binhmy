BEGIN;
ALTER TABLE care_records ADD COLUMN IF NOT EXISTS resident_status TEXT NOT NULL DEFAULT 'IN_FACILITY';
ALTER TABLE care_records DROP CONSTRAINT IF EXISTS chk_care_records_resident_status;
ALTER TABLE care_records ADD CONSTRAINT chk_care_records_resident_status CHECK (resident_status IN ('IN_FACILITY','HOME_LEAVE','HOSPITAL'));

CREATE TABLE IF NOT EXISTS care_event_catalog(code TEXT PRIMARY KEY,name_vi TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO care_event_catalog(code,name_vi,display_order,active) VALUES
('OBSERVATION','Theo dõi chung',10,TRUE),('FALL','Té ngã',20,TRUE),('PAIN','Đau',30,TRUE),('MEAL','Ăn uống',40,TRUE),('RESPIRATORY','Hô hấp',50,TRUE),('SKIN','Da / vết thương',60,TRUE),('BEHAVIOR','Hành vi / tinh thần',70,TRUE),('FAMILY','Liên hệ gia đình',80,TRUE),('OTHER','Khác',90,TRUE)
ON CONFLICT(code) DO UPDATE SET name_vi=EXCLUDED.name_vi,display_order=EXCLUDED.display_order,active=EXCLUDED.active;

CREATE TABLE IF NOT EXISTS care_record_events(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,care_record_id TEXT NOT NULL REFERENCES care_records(id) ON DELETE CASCADE,event_code TEXT NOT NULL REFERENCES care_event_catalog(code) ON DELETE RESTRICT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT uq_care_record_event UNIQUE(care_record_id,event_code));
CREATE INDEX IF NOT EXISTS idx_care_record_events_record ON care_record_events(care_record_id);
CREATE INDEX IF NOT EXISTS idx_care_record_events_code ON care_record_events(event_code);
CREATE INDEX IF NOT EXISTS idx_care_records_resident_status ON care_records(resident_status,occurred_at DESC) WHERE deleted=FALSE;

INSERT INTO care_record_events(care_record_id,event_code)
SELECT c.id,CASE WHEN c.event_type='HOSPITAL' THEN 'OBSERVATION' ELSE c.event_type END
FROM care_records c JOIN care_event_catalog e ON e.code=CASE WHEN c.event_type='HOSPITAL' THEN 'OBSERVATION' ELSE c.event_type END
ON CONFLICT(care_record_id,event_code) DO NOTHING;
COMMIT;
