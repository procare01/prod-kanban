-- Migration 020: add super_admin and ceo roles

-- Drop old constraint and add new one with super_admin and ceo
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('brigadir','controller','admin','super_admin','ceo','crm','crm_admin'));
