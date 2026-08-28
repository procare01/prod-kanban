-- ─── 037_crm_global_modern_theme.sql ────────────────────────────────────────
-- Store the CRM visual theme as one shared setting. The setting is readable by
-- every CRM user, while only the CRM super administrator can change it.

ALTER TABLE crm_bonus_settings
  ADD COLUMN IF NOT EXISTS modern_theme_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION get_crm_modern_theme()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT modern_theme_enabled FROM crm_bonus_settings LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION set_crm_modern_theme(
  p_admin_id  uuid,
  p_admin_pin text,
  p_enabled   boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_admin_pin IS DISTINCT FROM '1505' OR NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_admin_id
      AND u.role = 'super_admin'
      AND u.pin = '1505'
  ) THEN
    RAISE EXCEPTION 'CRM_SUPER_ADMIN_REQUIRED';
  END IF;

  UPDATE crm_bonus_settings
  SET modern_theme_enabled = p_enabled;
END;
$$;
