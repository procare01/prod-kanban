-- CRM administrators can view team hours and dashboards, without any editing
-- permissions granted by the work-hours write RPCs.

CREATE OR REPLACE FUNCTION assert_crm_hours_viewer(
  p_user_id uuid,
  p_user_pin text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_user_id
      AND u.pin = p_user_pin
      AND (
        u.role = 'crm_admin'
        OR (u.role IN ('super_admin', 'admin') AND u.pin = '1505')
      )
  ) THEN
    RAISE EXCEPTION 'CRM_HOURS_VIEW_REQUIRED';
  END IF;
END;
$$;

DO $$
DECLARE
  v_function regprocedure;
  v_definition text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.get_crm_work_hours_day(uuid,text,date)'::regprocedure,
    'public.get_crm_month_dashboard(uuid,text,date)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_function) INTO v_definition;
    v_definition := REPLACE(
      v_definition,
      'PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);',
      'PERFORM assert_crm_hours_viewer(p_admin_id, p_admin_pin);'
    );
    EXECUTE v_definition;
  END LOOP;
END;
$$;
