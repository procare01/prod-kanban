-- A day with saved work hours is a work day even when no orders were entered.

CREATE OR REPLACE FUNCTION get_crm_month_dashboard(
  p_admin_id uuid,
  p_admin_pin text,
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
  PERFORM assert_crm_hours_viewer(p_admin_id, p_admin_pin);

  SELECT threshold, rate_mid, rate_high
  INTO v_threshold, v_rate_mid, v_rate_high
  FROM crm_bonus_settings
  LIMIT 1;

  RETURN (
    WITH daily AS (
      SELECT
        ce.user_id,
        DATE(ce.created_at AT TIME ZONE 'UTC') AS work_day,
        SUM(ce.orders_count)::integer AS orders,
        SUM(ce.units_count)::integer AS units
      FROM crm_entries ce
      WHERE DATE(ce.created_at AT TIME ZONE 'UTC') BETWEEN v_month_start AND v_month_end
      GROUP BY ce.user_id, DATE(ce.created_at AT TIME ZONE 'UTC')
    ),
    performance AS (
      SELECT
        d.user_id,
        SUM(d.orders)::integer AS total_orders,
        SUM(d.units)::integer AS total_units,
        SUM(CASE
          WHEN d.orders <= v_threshold THEN 0
          WHEN d.orders <= 100 THEN (d.orders - v_threshold) * v_rate_mid
          ELSE (d.orders - v_threshold) * v_rate_high
        END)::integer AS total_bonus
      FROM daily d
      GROUP BY d.user_id
    ),
    month_hours AS (
      SELECT *
      FROM crm_work_hours_daily
      WHERE work_date BETWEEN v_month_start AND v_month_end
    ),
    active_days AS (
      SELECT user_id, work_day FROM daily
      UNION
      SELECT user_id, work_date
      FROM month_hours
      WHERE regular_hours > 0 OR overtime_hours > 0 OR saturday_hours > 0
    ),
    activity AS (
      SELECT user_id, COUNT(*)::integer AS days_active
      FROM active_days
      GROUP BY user_id
    ),
    saturday_ranked AS (
      SELECT
        user_id,
        work_date,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY work_date)::integer AS saturday_number
      FROM month_hours
      WHERE EXTRACT(ISODOW FROM work_date) IN (6, 7) AND saturday_hours > 0
    ),
    hours AS (
      SELECT
        h.user_id,
        SUM(h.regular_hours) AS regular_hours,
        SUM(h.overtime_hours) AS overtime_hours,
        SUM(h.saturday_hours) AS saturday_hours,
        COUNT(sr.saturday_number)::integer AS saturdays_worked,
        SUM(
          h.regular_hours
          + h.overtime_hours * h.overtime_coefficient
          + h.saturday_hours * CASE WHEN COALESCE(sr.saturday_number, 0) >= 3 THEN 1.5 ELSE 1.2 END
        ) AS weighted_hours
      FROM month_hours h
      LEFT JOIN saturday_ranked sr ON sr.user_id = h.user_id AND sr.work_date = h.work_date
      GROUP BY h.user_id
    ),
    rows AS (
      SELECT
        u.id AS user_id,
        u.name AS user_name,
        COALESCE(p.total_orders, 0) AS total_orders,
        COALESCE(p.total_units, 0) AS total_units,
        COALESCE(a.days_active, 0) AS days_active,
        COALESCE(p.total_bonus, 0) AS total_bonus,
        COALESCE(h.regular_hours, 0) AS regular_hours,
        COALESCE(h.overtime_hours, 0) AS overtime_hours,
        0::numeric AS overtime_coefficient,
        COALESCE(h.saturday_hours, 0) AS saturday_hours,
        COALESCE(h.saturdays_worked, 0) AS saturdays_worked,
        CASE
          WHEN COALESCE(h.saturdays_worked, 0) >= 3 THEN 1.5
          WHEN COALESCE(h.saturdays_worked, 0) >= 1 THEN 1.2
          ELSE 1.0
        END AS saturday_coefficient,
        ROUND(COALESCE(h.weighted_hours, 0), 2) AS weighted_hours
      FROM users u
      LEFT JOIN performance p ON p.user_id = u.id
      LEFT JOIN activity a ON a.user_id = u.id
      LEFT JOIN hours h ON h.user_id = u.id
      WHERE u.role = 'crm' OR (u.role = 'super_admin' AND u.name = 'Ігор Яблонський')
    )
    SELECT COALESCE(
      json_agg(json_build_object(
        'user_id', user_id, 'user_name', user_name,
        'total_orders', total_orders, 'total_units', total_units,
        'days_active', days_active, 'total_bonus', total_bonus,
        'regular_hours', regular_hours, 'overtime_hours', overtime_hours,
        'overtime_coefficient', overtime_coefficient,
        'saturday_hours', saturday_hours, 'saturdays_worked', saturdays_worked,
        'saturday_coefficient', saturday_coefficient, 'weighted_hours', weighted_hours
      ) ORDER BY user_name),
      '[]'::json
    )
    FROM rows
  );
END;
$$;
