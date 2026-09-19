BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BCARE = SOURCE OF TRUTH. These tables are only reference/cache.
-- Never treat them as the master resident/branch records.
-- ============================================================
CREATE TABLE IF NOT EXISTS bcare_branches_ref (
  bcare_branch_id TEXT PRIMARY KEY,
  code_cache TEXT NULL,
  name_cache TEXT NOT NULL DEFAULT '',
  raw_cache JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bcare_residents_ref (
  bcare_resident_id TEXT PRIMARY KEY,
  code_cache TEXT NOT NULL DEFAULT '',
  full_name_cache TEXT NOT NULL DEFAULT '',
  branch_id TEXT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE SET NULL,
  area_id_cache TEXT NULL,
  area_name_cache TEXT NOT NULL DEFAULT '',
  room_id_cache TEXT NULL,
  room_name_cache TEXT NOT NULL DEFAULT '',
  bed_name_cache TEXT NOT NULL DEFAULT '',
  image_cache TEXT NOT NULL DEFAULT '',
  active_cache BOOLEAN NOT NULL DEFAULT TRUE,
  raw_cache JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bcare_residents_branch ON bcare_residents_ref(branch_id, full_name_cache);
CREATE INDEX IF NOT EXISTS idx_bcare_residents_sync ON bcare_residents_ref(last_synced_at DESC);

-- ============================================================
-- LOCAL AUTH / RBAC for this middleware application.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL DEFAULT '',
  employee_code TEXT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  branch_id TEXT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE SET NULL,
  branch_name_cache TEXT NOT NULL DEFAULT '',
  area_id_cache TEXT NULL,
  area_name_cache TEXT NOT NULL DEFAULT '',
  full_access BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at TIMESTAMPTZ NULL,
  deactivated_by TEXT NULL,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY(user_id, permission)
);

-- ============================================================
-- LOCAL MASTER: staff roster is owned by this middleware.
-- 1 branch -> N staff_members.
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_members (
  id TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE RESTRICT,
  branch_name_cache TEXT NOT NULL DEFAULT '',
  area_id_cache TEXT NULL,
  area_name_cache TEXT NOT NULL DEFAULT '',
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  role_cache TEXT NOT NULL DEFAULT 'STAFF',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NULL,
  deleted_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NULL,
  delete_reason TEXT NULL,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(branch_id, employee_code)
);
CREATE INDEX IF NOT EXISTS idx_staff_branch_active ON staff_members(branch_id, active, deleted, full_name);

-- ============================================================
-- LOCAL OPERATIONS: shifts are owned by middleware.
-- 1 branch -> N shifts.
-- N shifts <-> N staff via shift_staff.
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  shift_date DATE NOT NULL,
  shift_type TEXT NOT NULL CHECK (shift_type IN ('MORNING','NIGHT')),
  status TEXT NOT NULL DEFAULT 'OPEN',
  branch_id TEXT NOT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE RESTRICT,
  branch_name_cache TEXT NOT NULL DEFAULT '',
  area_id_cache TEXT NULL,
  area_name_cache TEXT NOT NULL DEFAULT '',
  room_id_cache TEXT NULL,
  primary_recorder_staff_id TEXT NULL REFERENCES staff_members(id) ON DELETE SET NULL,
  auto_created BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  staff_updated_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  staff_updated_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ NULL,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_date ON shifts(branch_id, shift_date DESC, shift_type, status);

CREATE TABLE IF NOT EXISTS shift_staff (
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  is_primary_recorder BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shift_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_shift_staff_staff ON shift_staff(staff_id, shift_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_one_primary ON shift_staff(shift_id) WHERE is_primary_recorder = TRUE;

-- Snapshot roster at the time a shift is opened. The resident itself still belongs to BCARE.
CREATE TABLE IF NOT EXISTS shift_residents (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  bcare_resident_id TEXT NOT NULL REFERENCES bcare_residents_ref(bcare_resident_id) ON DELETE RESTRICT,
  code_snapshot TEXT NOT NULL DEFAULT '',
  full_name_snapshot TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE RESTRICT,
  branch_name_snapshot TEXT NOT NULL DEFAULT '',
  area_id_snapshot TEXT NULL,
  area_name_snapshot TEXT NOT NULL DEFAULT '',
  room_id_snapshot TEXT NULL,
  room_name_snapshot TEXT NOT NULL DEFAULT '',
  bed_name_snapshot TEXT NOT NULL DEFAULT '',
  image_snapshot TEXT NOT NULL DEFAULT '',
  derived_status TEXT NOT NULL DEFAULT 'NO_RECORDED_CHANGE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(shift_id, bcare_resident_id)
);
CREATE INDEX IF NOT EXISTS idx_shift_resident_resident ON shift_residents(bcare_resident_id, shift_id);

-- ============================================================
-- LOCAL CARE EXTENSIONS.
-- 1 resident-ref -> N care_records.
-- 1 shift -> N care_records.
-- 1 care_record -> 0..1 vitals (true 1:1 via PK/FK).
-- 1 care_record -> N images.
-- ============================================================
CREATE TABLE IF NOT EXISTS care_records (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NULL,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  bcare_resident_id TEXT NOT NULL REFERENCES bcare_residents_ref(bcare_resident_id) ON DELETE RESTRICT,
  resident_name_snapshot TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'OBSERVATION',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  occurred_at TIMESTAMPTZ NOT NULL,
  content TEXT NOT NULL,
  intervention TEXT NOT NULL DEFAULT '',
  notified_to TEXT NOT NULL DEFAULT '',
  requires_handover BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE RESTRICT,
  branch_name_snapshot TEXT NOT NULL DEFAULT '',
  area_id_snapshot TEXT NULL,
  area_name_snapshot TEXT NOT NULL DEFAULT '',
  room_name_snapshot TEXT NOT NULL DEFAULT '',
  bed_name_snapshot TEXT NOT NULL DEFAULT '',
  image_snapshot TEXT NOT NULL DEFAULT '',
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by_name_cache TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by_name_cache TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NULL,
  delete_reason TEXT NULL,
  attention_level TEXT NULL,
  attention_status TEXT NULL,
  attention_resolved_at TIMESTAMPTZ NULL,
  attention_resolved_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_care_client_request ON care_records(client_request_id) WHERE client_request_id IS NOT NULL AND client_request_id <> '';
CREATE INDEX IF NOT EXISTS idx_care_resident_time ON care_records(bcare_resident_id, occurred_at DESC) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_care_shift_time ON care_records(shift_id, occurred_at DESC) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_care_attention ON care_records(branch_id, attention_status, attention_level, occurred_at DESC) WHERE deleted = FALSE;

CREATE TABLE IF NOT EXISTS care_record_vitals (
  care_record_id TEXT PRIMARY KEY REFERENCES care_records(id) ON DELETE CASCADE,
  pulse NUMERIC(6,2) NULL,
  temperature NUMERIC(5,2) NULL,
  bp_sys NUMERIC(6,2) NULL,
  bp_dia NUMERIC(6,2) NULL,
  spo2 NUMERIC(6,2) NULL,
  respiratory_rate NUMERIC(6,2) NULL,
  concern BOOLEAN NOT NULL DEFAULT FALSE,
  alert_level TEXT NOT NULL DEFAULT 'NORMAL',
  alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  urgent JSONB NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS care_record_images (
  id TEXT PRIMARY KEY,
  care_record_id TEXT NOT NULL REFERENCES care_records(id) ON DELETE CASCADE,
  object_key TEXT NULL,
  private_url TEXT NULL,
  mime_type TEXT NULL,
  size_bytes BIGINT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  legacy_data_omitted BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_care_images_record ON care_record_images(care_record_id, created_at);

-- 1 resident-ref -> N toileting logs.
CREATE TABLE IF NOT EXISTS toileting_logs (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NULL,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  bcare_resident_id TEXT NOT NULL REFERENCES bcare_residents_ref(bcare_resident_id) ON DELETE RESTRICT,
  resident_name_snapshot TEXT NOT NULL DEFAULT '',
  bowel_status TEXT NOT NULL,
  urine_status TEXT NOT NULL,
  urine_detail TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE RESTRICT,
  area_id_snapshot TEXT NULL,
  area_name_snapshot TEXT NOT NULL DEFAULT '',
  room_name_snapshot TEXT NOT NULL DEFAULT '',
  bed_name_snapshot TEXT NOT NULL DEFAULT '',
  image_snapshot TEXT NOT NULL DEFAULT '',
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by_name_cache TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NULL,
  delete_reason TEXT NULL,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_toilet_client_request ON toileting_logs(client_request_id) WHERE client_request_id IS NOT NULL AND client_request_id <> '';
CREATE INDEX IF NOT EXISTS idx_toilet_resident_time ON toileting_logs(bcare_resident_id, created_at DESC) WHERE deleted = FALSE;

-- Local care instruction / execution support. This does NOT replace BCARE prescription master data.
CREATE TABLE IF NOT EXISTS care_instructions (
  id TEXT PRIMARY KEY,
  bcare_resident_id TEXT NOT NULL REFERENCES bcare_residents_ref(bcare_resident_id) ON DELETE RESTRICT,
  resident_name_snapshot TEXT NOT NULL DEFAULT '',
  resident_code_snapshot TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE RESTRICT,
  branch_name_snapshot TEXT NOT NULL DEFAULT '',
  area_id_snapshot TEXT NULL,
  area_name_snapshot TEXT NOT NULL DEFAULT '',
  room_name_snapshot TEXT NOT NULL DEFAULT '',
  bed_name_snapshot TEXT NOT NULL DEFAULT '',
  instruction_type TEXT NOT NULL DEFAULT 'CARE_INSTRUCTION',
  morning TEXT NOT NULL DEFAULT '',
  noon TEXT NOT NULL DEFAULT '',
  evening TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  source TEXT NOT NULL DEFAULT 'CARE_INSTRUCTION',
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by_name_cache TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NULL,
  stopped_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  stopped_at TIMESTAMPTZ NULL,
  stop_reason TEXT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_care_instruction_resident ON care_instructions(bcare_resident_id, status, created_at DESC) WHERE deleted = FALSE;

-- ============================================================
-- HANDOVER.
-- 1 shift -> 0..1 handover (UNIQUE shift_id).
-- 1 handover -> N signatures.
-- ============================================================
CREATE TABLE IF NOT EXISTS handovers (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1,
  summary_note TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by_name_cache TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ NULL,
  received_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  received_by_name_cache TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NULL,
  legacy_extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS handover_signatures (
  handover_id TEXT NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  username_cache TEXT NOT NULL DEFAULT '',
  employee_code_cache TEXT NOT NULL DEFAULT '',
  full_name_cache TEXT NOT NULL DEFAULT '',
  acknowledged BOOLEAN NOT NULL DEFAULT TRUE,
  acknowledged_at TIMESTAMPTZ NULL,
  recorded_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY(handover_id, staff_id)
);

-- ============================================================
-- AUDIT + INTEGRATION OBSERVABILITY.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  branch_id TEXT NULL REFERENCES bcare_branches_ref(bcare_branch_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_logs(object_type, object_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_branch ON audit_logs(branch_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'BCARE',
  operation TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '',
  branch_id TEXT NULL,
  success BOOLEAN NOT NULL,
  item_count INTEGER NULL,
  duration_ms INTEGER NULL,
  error_message TEXT NULL,
  request_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_sync_time ON integration_sync_logs(provider, occurred_at DESC);

INSERT INTO schema_migrations(version)
VALUES ('001_middleware_schema')
ON CONFLICT(version) DO NOTHING;

COMMIT;
