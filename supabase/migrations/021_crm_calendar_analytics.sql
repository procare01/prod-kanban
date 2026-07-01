-- ─── 021_crm_calendar_analytics.sql ─────────────────────────────────────────
-- Bind CRM analytics periods to calendar boundaries:
--   p_days = 1  -> today
--   p_days = 7  -> current calendar week (Monday through today)
--   p_days = 30 -> current calendar month (1st through today)

CREATE OR REPLACE FUNCTION get_crm_analytics(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false,
  p_days     integer DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_start_date date;
  v_end_date   date := CURRENT_DATE;
BEGIN
  v_start_date := CASE
    WHEN p_days = 1  THEN CURRENT_DATE
    WHEN p_days = 7  THEN DATE_TRUNC('week', CURRENT_DATE)::date
    WHEN p_days = 30 THEN DATE_TRUNC('month', CURRENT_DATE)::date
    ELSE (CURRENT_DATE - GREATEST(p_days - 1, 0) * INTERVAL '1 day')::date
  END;

  RETURN json_build_object(

    -- daily series for the selected calendar period
    'daily', (
      SELECT COALESCE(json_agg(row_data ORDER BY (row_data->>'date')), '[]'::json)
      FROM (
        SELECT json_build_object(
          'date',   TO_CHAR(d.day, 'YYYY-MM-DD'),
          'orders', COALESCE(SUM(ce.orders_count), 0),
          'units',  COALESCE(SUM(ce.units_count),  0)
        ) AS row_data
        FROM generate_series(
          v_start_date,
          v_end_date,
          INTERVAL '1 day'
        ) AS d(day)
        LEFT JOIN crm_entries ce
          ON DATE(ce.created_at AT TIME ZONE 'UTC') = d.day
          AND (p_is_admin OR ce.user_id = p_user_id)
        GROUP BY d.day
        ORDER BY d.day
      ) sub
    ),

    -- per-user KPI for the selected calendar period
    'by_user_today', (
      SELECT COALESCE(json_agg(row_data), '[]'::json)
      FROM (
        SELECT json_build_object(
          'user_id',         u.id,
          'user_name',       u.name,
          'total_orders',    SUM(ce.orders_count),
          'total_units',     SUM(ce.units_count),
          'orders_per_hour', ROUND(SUM(ce.orders_count)::numeric / (GREATEST((v_end_date - v_start_date + 1), 1) * 8), 2),
          'units_per_hour',  ROUND(SUM(ce.units_count)::numeric / (GREATEST((v_end_date - v_start_date + 1), 1) * 8), 2)
        ) AS row_data
        FROM crm_entries ce
        JOIN users u ON u.id = ce.user_id
        WHERE DATE(ce.created_at AT TIME ZONE 'UTC') BETWEEN v_start_date AND v_end_date
          AND (p_is_admin OR ce.user_id = p_user_id)
        GROUP BY u.id, u.name
      ) sub
    ),

    -- monthly totals remain bound to the current calendar month
    'monthly', (
      SELECT json_build_object(
        'total_orders', COALESCE(SUM(orders_count), 0),
        'total_units',  COALESCE(SUM(units_count),  0)
      )
      FROM crm_entries
      WHERE DATE_TRUNC('month', created_at AT TIME ZONE 'UTC') = DATE_TRUNC('month', CURRENT_DATE)
        AND (p_is_admin OR user_id = p_user_id)
    )
  );
END;
$$;
