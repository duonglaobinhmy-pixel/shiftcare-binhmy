-- Allow CSKH also when the database previously ran only migration 001.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
CHECK (role IN ('ADMIN','BRANCH_DIRECTOR','CARE_SHARED','CSKH'));
