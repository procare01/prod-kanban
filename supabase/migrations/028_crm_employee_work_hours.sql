-- Let a CRM employee record and view only their own daily hours. Super-admin
-- functions from the previous migrations remain the path for team-wide edits.

CREATE OR REPLACE FUNCTION assert_crm_employee(
  p_user_id uuid,
  p_user_pin text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p_user_id AND u.role = 'crm' AND u.pin = p_user_pin
  ) THEN
    RAISE EXCEPTION 'CRM_EMPLOYEE_REQUIRED';
  END IF;
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

  IF p_date > CURRENT_DATE
     OR p_regular_hours < 0 OR p_overtime_hours < 0 OR p_saturday_hours < 0
     OR p_overtime_coefficient NOT IN (1.0, 1.2, 1.5, 2.0)
     OR (EXTRACT(ISODOW FROM p_date) <> 6 AND p_saturday_hours <> 0) THEN
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

CREATE OR REPLACE FUNCTION get_my_crm_work_hours_day(
  p_user_id uuid,
  p_user_pin text,
  p_date date
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month_start date := DATE_TRUNC('month', p_date)::date;
BEGIN
  PERFORM assert_crm_employee(p_user_id, p_user_pin);

  RETURN (
    WITH previous_saturdays AS (
      SELECT COUNT(*)::integer AS saturday_count
      FROM crm_work_hours_daily h
      WHERE h.user_id = p_user_id
        AND h.work_date >= v_month_start
        AND h.work_date < p_date
        AND EXTRACT(ISODOW FROM h.work_date) = 6
        AND h.saturday_hours > 0
    )
    SELECT COALESCE(json_agg(json_build_object(
      'user_id', u.id,
      'user_name', u.name,
      'work_date', p_date,
      'regular_hours', COALESCE(h.regular_hours, 0),
      'overtime_hours', COALESCE(h.overtime_hours, 0),
      'overtime_coefficient', COALESCE(h.overtime_coefficient, 1.5),
      'saturday_hours', COALESCE(h.saturday_hours, 0),
      'saturday_number', CASE WHEN EXTRACT(ISODOW FROM p_date) = 6 THEN ps.saturday_count + 1 ELSE 0 END,
      'saturday_coefficient', CASE
        WHEN EXTRACT(ISODOW FROM p_date) <> 6 THEN 1.0
        WHEN ps.saturday_count >= 2 THEN 1.5 ELSE 1.2
      END,
      'weighted_hours', ROUND(
        COALESCE(h.regular_hours, 0)
        + COALESCE(h.overtime_hours, 0) * COALESCE(h.overtime_coefficient, 1.5)
        + COALESCE(h.saturday_hours, 0) * CASE WHEN ps.saturday_count >= 2 THEN 1.5 ELSE 1.2 END,
        2
      )
    )), '[]'::json)
    FROM users u
    CROSS JOIN previous_saturdays ps
    LEFT JOIN crm_work_hours_daily h ON h.user_id = u.id AND h.work_date = p_date
    WHERE u.id = p_user_id AND u.role = 'crm'
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_my_crm_month_dashboard(
  p_user_id uuid,
  p_user_pin text,
  p_month date
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month_start date := DATE_TRUNC('month', p_month)::date;
  v_month_end date := (DATE_TRUNC('month', p_month) + INTERVAL '1 month - 1 day')::date;
  v_threshold integer := 80;
  v_rate_mid integer := 6;
  v_rate_high integer := 8;
BEGIN
  PERFORM assert_crm_employee(p_user_id, p_user_pin);

  SELECT threshold, rate_mid, rate_high
  INTO v_threshold, v_rate_mid, v_rate_high
  FROM crm_bonus_settings
  LIMIT 1;

  RETURN (
    WITH daily AS (
      SELECT DATE(ce.created_at AT TIME ZONE 'UTC') AS work_day,
        SUM(ce.orders_count)::integer AS orders, SUM(ce.units_count)::integer AS units
      FROM crm_entries ce
      WHERE ce.user_id = p_user_id
        AND DATE(ce.created_at AT TIME ZONE 'UTC') BETWEEN v_month_start AND v_month_end
      GROUP BY DATE(ce.created_at AT TIME ZONE 'UTC')
    ),
    performance AS (
      SELECT COALESCE(SUM(orders), 0)::integer AS total_orders,
        COALESCE(SUM(units), 0)::integer AS total_units, COUNT(*)::integer AS days_active,
        COALESCE(SUM(CASE
          WHEN orders <= v_threshold THEN 0
          WHEN orders <= 100 THEN (orders - v_threshold) * v_rate_mid
          ELSE (orders - v_threshold) * v_rate_high
        END), 0)::integer AS total_bonus
      FROM daily
    ),
    saturday_ranked AS (
      SELECT h.work_date, ROW_NUMBER() OVER (ORDER BY h.work_date)::integer AS saturday_number
      FROM crm_work_hours_daily h
      WHERE h.user_id = p_user_id AND h.work_date BETWEEN v_month_start AND v_month_end
        AND EXTRACT(ISODOW FROM h.work_date) = 6 AND h.saturday_hours > 0
    ),
    hours AS (
      SELECT COALESCE(SUM(h.regular_hours), 0) AS regular_hours,
        COALESCE(SUM(h.overtime_hours), 0) AS overtime_hours,
        COALESCE(SUM(h.saturday_hours), 0) AS saturday_hours,
        COUNT(sr.saturday_number)::integer AS saturdays_worked,
        COALESCE(SUM(h.regular_hours + h.overtime_hours * h.overtime_coefficient
          + h.saturday_hours * CASE WHEN COALESCE(sr.saturday_number, 0) >= 3 THEN 1.5 ELSE 1.2 END), 0) AS weighted_hours
      FROM crm_work_hours_daily h
      LEFT JOIN saturday_ranked sr ON sr.work_date = h.work_date
      WHERE h.user_id = p_user_id AND h.work_date BETWEEN v_month_start AND v_month_end
    )
    SELECT json_agg(json_build_object(
      'user_id', u.id, 'user_name', u.name,
      'total_orders', p.total_orders, 'total_units', p.total_units,
      'days_active', p.days_active, 'total_bonus', p.total_bonus,
      'regular_hours', h.regular_hours, 'overtime_hours', h.overtime_hours,
      'overtime_coefficient', 0::numeric, 'saturday_hours', h.saturday_hours,
      'saturdays_worked', h.saturdays_worked,
      'saturday_coefficient', CASE WHEN h.saturdays_worked >= 3 THEN 1.5 WHEN h.saturdays_worked >= 1 THEN 1.2 ELSE 1.0 END,
      'weighted_hours', ROUND(h.weighted_hours, 2)
    ))
    FROM users u
    CROSS JOIN performance p
    CROSS JOIN hours h
    WHERE u.id = p_user_id AND u.role = 'crm'
  );
END;
$$;
