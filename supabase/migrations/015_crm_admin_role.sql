-- ─── 015_crm_admin_role.sql ──────────────────────────────────────────────────
-- Add crm_admin role: access to CRM warehouse + full analytics, no main board

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('brigadir', 'controller', 'admin', 'crm', 'crm_admin'));
