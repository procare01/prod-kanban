-- CRM administrators can view the warehouse, but only `crm` employees are
-- included in operational lists, totals, charts, bonuses and recent entries.

-- Superseded by the dated version below; retaining it would leave a route
-- without the role filter for callers that omit p_date.
DROP FUNCTION IF EXISTS get_crm_today(uuid, boolean);

CREATE OR REPLACE FUNCTION get_crm_today(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'total_orders', COALESCE(SUM(ce.orders_count), 0),
    'total_units', COALESCE(SUM(ce.units_count), 0),
    'entries', COALESCE(json_agg(json_build_object(
      'id', ce.id, 'user_id', ce.user_id, 'user_name', u.name,
      'orders_count', ce.orders_count, 'units_count', ce.units_count,
      'created_at', ce.created_at
    ) ORDER BY ce.created_at DESC), '[]'::json)
  ) INTO v_result
  FROM crm_entries ce
  JOIN users u ON u.id = ce.user_id
  WHERE DATE(ce.created_at AT TIME ZONE 'UTC') = p_date
    AND u.role = 'crm'
    AND (p_is_admin OR ce.user_id = p_user_id);

  RETURN COALESCE(v_result, '{"total_orders":0,"total_units":0,"entries":[]}'::json);
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_analytics(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_days integer DEFAULT 30,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_anchor_date date := LEAST(COALESCE(p_date, CURRENT_DATE), CURRENT_DATE);
  v_start_date date;
  v_end_date date;
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
    'daily', (
      SELECT COALESCE(json_agg(row_data ORDER BY (row_data->>'date')), '[]'::json)
      FROM (
        SELECT json_build_object(
          'date', TO_CHAR(d.day, 'YYYY-MM-DD'),
          'orders', COALESCE(SUM(ce.orders_count), 0),
          'units', COALESCE(SUM(ce.units_count), 0)
        ) AS row_data
        FROM generate_series(v_start_date, v_end_date, INTERVAL '1 day') AS d(day)
        LEFT JOIN crm_entries ce ON DATE(ce.created_at AT TIME ZONE 'UTC') = d.day
          AND (p_is_admin OR ce.user_id = p_user_id)
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = ce.user_id AND u.role = 'crm')
        GROUP BY d.day
        ORDER BY d.day
      ) sub
    ),
    'by_user_today', (
      SELECT COALESCE(json_agg(row_data), '[]'::json)
      FROM (
        SELECT json_build_object(
          'user_id', u.id, 'user_name', u.name,
          'total_orders', SUM(ce.orders_count), 'total_units', SUM(ce.units_count),
          'orders_per_hour', ROUND(SUM(ce.orders_count)::numeric / (GREATEST((v_end_date - v_start_date + 1), 1) * 8), 2),
          'units_per_hour', ROUND(SUM(ce.units_count)::numeric / (GREATEST((v_end_date - v_start_date + 1), 1) * 8), 2)
        ) AS row_data
        FROM crm_entries ce
        JOIN users u ON u.id = ce.user_id
        WHERE DATE(ce.created_at AT TIME ZONE 'UTC') BETWEEN v_start_date AND v_end_date
          AND u.role = 'crm'
          AND (p_is_admin OR ce.user_id = p_user_id)
        GROUP BY u.id, u.name
      ) sub
    ),
    'monthly', (
      SELECT json_build_object(
        'total_orders', COALESCE(SUM(ce.orders_count), 0),
        'total_units', COALESCE(SUM(ce.units_count), 0)
      )
      FROM crm_entries ce
      JOIN users u ON u.id = ce.user_id
      WHERE DATE(ce.created_at AT TIME ZONE 'UTC') BETWEEN DATE_TRUNC('month', v_anchor_date)::date
        AND LEAST((DATE_TRUNC('month', v_anchor_date)::date + INTERVAL '1 month - 1 day')::date, CURRENT_DATE)
        AND u.role = 'crm'
        AND (p_is_admin OR ce.user_id = p_user_id)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_recent(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_limit integer DEFAULT 40
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_data), '[]'::json)
    FROM (
      SELECT json_build_object(
        'id', ce.id, 'user_id', ce.user_id, 'user_name', u.name,
        'orders_count', ce.orders_count, 'units_count', ce.units_count,
        'created_at', ce.created_at
      ) AS row_data
      FROM crm_entries ce
      JOIN users u ON u.id = ce.user_id
      WHERE u.role = 'crm'
        AND (p_is_admin OR ce.user_id = p_user_id)
      ORDER BY ce.created_at DESC
      LIMIT p_limit
    ) sub
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_monthly_bonus(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_threshold integer;
  v_rate_mid integer;
  v_rate_high integer;
BEGIN
  SELECT threshold, rate_mid, rate_high
  INTO v_threshold, v_rate_mid, v_rate_high
  FROM crm_bonus_settings
  LIMIT 1;

  RETURN (
    SELECT COALESCE(json_agg(row_data ORDER BY (row_data->>'total_bonus')::numeric DESC), '[]'::json)
    FROM (
      SELECT json_build_object(
        'user_id', user_id, 'user_name', user_name,
        'total_orders', total_orders_month, 'total_bonus', total_bonus,
        'days_active', days_active
      ) AS row_data
      FROM (
        SELECT u.id AS user_id, u.name AS user_name,
          SUM(d.daily_orders) AS total_orders_month, COUNT(*) AS days_active,
          SUM(CASE
            WHEN d.daily_orders <= v_threshold THEN 0
            WHEN d.daily_orders <= 100 THEN (d.daily_orders - v_threshold) * v_rate_mid
            ELSE (d.daily_orders - v_threshold) * v_rate_high
          END) AS total_bonus
        FROM (
          SELECT ce.user_id, DATE(ce.created_at AT TIME ZONE 'UTC') AS day,
            SUM(ce.orders_count) AS daily_orders
          FROM crm_entries ce
          JOIN users u ON u.id = ce.user_id
          WHERE DATE_TRUNC('month', ce.created_at AT TIME ZONE 'UTC') = DATE_TRUNC('month', CURRENT_DATE)
            AND u.role = 'crm'
            AND (p_is_admin OR ce.user_id = p_user_id)
          GROUP BY ce.user_id, DATE(ce.created_at AT TIME ZONE 'UTC')
        ) d
        JOIN users u ON u.id = d.user_id
        GROUP BY u.id, u.name
      ) agg
    ) sub
  );
END;
$$;
