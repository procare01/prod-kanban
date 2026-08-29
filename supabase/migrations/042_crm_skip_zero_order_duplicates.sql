-- Hours are stored in crm_work_hours_daily. A 0/0 order entry adds no data and
-- duplicates the same worker in the records feed when that day has real orders.

DELETE FROM crm_entries zero_entry
WHERE zero_entry.orders_count = 0
  AND zero_entry.units_count = 0
  AND EXISTS (
    SELECT 1
    FROM crm_entries actual_entry
    WHERE actual_entry.user_id = zero_entry.user_id
      AND DATE(actual_entry.created_at AT TIME ZONE 'Europe/Kyiv') = DATE(zero_entry.created_at AT TIME ZONE 'Europe/Kyiv')
      AND (actual_entry.orders_count <> 0 OR actual_entry.units_count <> 0)
  );

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

  IF p_orders = 0 AND p_units = 0 THEN
    RETURN json_build_object('id', NULL, 'created_at', p_created_at);
  END IF;

  INSERT INTO crm_entries (user_id, orders_count, units_count, created_at)
  VALUES (p_user_id, p_orders, p_units, p_created_at)
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN json_build_object('id', v_id, 'created_at', v_created_at);
END;
$$;

CREATE OR REPLACE FUNCTION submit_crm_entry_as_super_admin(
  p_admin_id uuid,
  p_admin_pin text,
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
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  IF p_orders < 0 OR p_units < 0 OR NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_user_id AND role = 'crm'
  ) THEN
    RAISE EXCEPTION 'INVALID_CRM_ENTRY';
  END IF;

  IF p_orders = 0 AND p_units = 0 THEN
    RETURN json_build_object('id', NULL, 'created_at', p_created_at);
  END IF;

  INSERT INTO crm_entries (user_id, orders_count, units_count, created_at)
  VALUES (p_user_id, p_orders, p_units, p_created_at)
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN json_build_object('id', v_id, 'created_at', v_created_at);
END;
$$;
