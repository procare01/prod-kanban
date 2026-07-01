-- ─── 022_crm_analytics_period_navigation.sql ────────────────────────────────
-- Allow CRM analytics to load selected calendar days, weeks, and months.

DROP FUNCTION IF EXISTS get_crm_analytics(uuid, boolean, integer);
DROP FUNCTION IF EXISTS get_crm_analytics(uuid, boolean, integer, date);

CREATE OR REPLACE FUNCTION get_crm_analytics(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false,
  p_days     integer DEFAULT 30,
  p_date     date    DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_anchor_date date := LEAST(COALESCE(p_date, CURRENT_DATE), CURRENT_DATE);
  v_start_date date;
  v_end_date   date;
  v_period_end date;
BEGIN
  IF p_days = 1 THEN
    v_start_date := v_anchor_date;
    v_period_end := v_anchor_date;
  ELSIF p_days = 7 THEN
    v_start_date := DATE_TRUNC('week', v_anchor_date)::date;
    v_period_end := (v_start_date + INTERVAL '6 days')::date;
  ELSIF p_days = 30 THEN
    v_start_date := DATE_TRUNC('month', v_anchor_date)::date;
    v_period_end := (v_start_date + INTERVAL '1 month - 1 day')::date;
  ELSE
    v_start_date := (v_anchor_date - GREATEST(p_days - 1, 0) * INTERVAL '1 day')::date;
    v_period_end := v_anchor_date;
  END IF;

  v_end_date := LEAST(v_period_end, CURRENT_DATE);

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

    -- monthly totals remain bound to the selected calendar month
    'monthly', (
      SELECT json_build_object(
        'total_orders', COALESCE(SUM(orders_count), 0),
        'total_units',  COALESCE(SUM(units_count),  0)
      )
      FROM crm_entries
      WHERE DATE(created_at AT TIME ZONE 'UTC') BETWEEN DATE_TRUNC('month', v_anchor_date)::date
        AND LEAST(
          (DATE_TRUNC('month', v_anchor_date)::date + INTERVAL '1 month - 1 day')::date,
          CURRENT_DATE
        )
        AND (p_is_admin OR user_id = p_user_id)
    )
  );
END;
$$;
