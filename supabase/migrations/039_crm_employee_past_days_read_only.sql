-- CRM employees may view prior dates, but only a super-admin may change them.

CREATE OR REPLACE FUNCTION submit_crm_entry(
  p_user_id uuid,
  p_orders integer,
  p_units integer,
  p_created_at timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
  v_created_at timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND role = 'crm')
     AND (p_created_at AT TIME ZONE 'Europe/Kyiv')::date <> (now() AT TIME ZONE 'Europe/Kyiv')::date THEN
    RAISE EXCEPTION 'CRM_EMPLOYEE_CURRENT_DAY_ONLY';
  END IF;

  INSERT INTO crm_entries (user_id, orders_count, units_count, created_at)
  VALUES (p_user_id, p_orders, p_units, p_created_at)
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN json_build_object('id', v_id, 'created_at', v_created_at);
END;
$$;

CREATE OR REPLACE FUNCTION set_my_crm_work_hours(
  p_user_id uuid,
  p_user_pin text,
  p_date date,
  p_regular_hours numeric,
  p_overtime_hours numeric,
  p_overtime_coefficient numeric,
  p_saturday_hours numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM assert_crm_employee(p_user_id, p_user_pin);

  IF p_date <> (now() AT TIME ZONE 'Europe/Kyiv')::date THEN
    RAISE EXCEPTION 'CRM_EMPLOYEE_CURRENT_DAY_ONLY';
  END IF;

  IF p_regular_hours < 0 OR p_overtime_hours < 0 OR p_saturday_hours < 0
     OR p_overtime_coefficient NOT IN (1.0, 1.2, 1.5, 2.0)
     OR (EXTRACT(ISODOW FROM p_date) NOT IN (6, 7) AND p_saturday_hours <> 0) THEN
    RAISE EXCEPTION 'INVALID_CRM_WORK_HOURS';
  END IF;

  INSERT INTO crm_work_hours_daily (
    user_id, work_date, regular_hours, overtime_hours,
    overtime_coefficient, saturday_hours, updated_by, updated_at
  ) VALUES (
    p_user_id, p_date, p_regular_hours, p_overtime_hours,
    p_overtime_coefficient, p_saturday_hours, p_user_id, now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE SET
    regular_hours = EXCLUDED.regular_hours,
    overtime_hours = EXCLUDED.overtime_hours,
    overtime_coefficient = EXCLUDED.overtime_coefficient,
    saturday_hours = EXCLUDED.saturday_hours,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
END;
$$;
