-- CRM dates are selected in Kyiv time. Keep every report on that same date
-- boundary so entries made after local midnight do not move to the prior day.

DO $$
DECLARE
  v_function regprocedure;
  v_definition text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.get_crm_month_dashboard(uuid,text,date)'::regprocedure,
    'public.get_my_crm_month_dashboard(uuid,text,date)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_function) INTO v_definition;
    IF POSITION('AT TIME ZONE ''UTC''' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'CRM_KYIV_DATE_PATTERN_NOT_FOUND: %', v_function;
    END IF;
    v_definition := REPLACE(v_definition, 'AT TIME ZONE ''UTC''', 'AT TIME ZONE ''Europe/Kyiv''');
    EXECUTE v_definition;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_today(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_date date DEFAULT ((now() AT TIME ZONE 'Europe/Kyiv')::date)
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'total_orders', COALESCE(SUM(ce.orders_count), 0),
    'total_units', COALESCE(SUM(ce.units_count), 0),
    'entries', COALESCE(
      json_agg(
        json_build_object(
          'id', ce.id,
          'user_id', ce.user_id,
          'user_name', u.name,
          'orders_count', ce.orders_count,
          'units_count', ce.units_count,
          'created_at', ce.created_at
        ) ORDER BY ce.created_at DESC
      ),
      '[]'::json
    )
  )
  INTO v_result
  FROM crm_entries ce
  JOIN users u ON u.id = ce.user_id
  WHERE DATE(ce.created_at AT TIME ZONE 'Europe/Kyiv') = p_date
    AND (p_is_admin OR ce.user_id = p_user_id);

  RETURN COALESCE(v_result, '{"total_orders":0,"total_units":0,"entries":[]}'::json);
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_analytics(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_days integer DEFAULT 30,
  p_date date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
  v_anchor_date date := LEAST(COALESCE(p_date, v_today), v_today);
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

  v_end_date := LEAST(v_period_end, v_today);

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
        LEFT JOIN crm_entries ce
          ON DATE(ce.created_at AT TIME ZONE 'Europe/Kyiv') = d.day
          AND (p_is_admin OR ce.user_id = p_user_id)
        GROUP BY d.day
        ORDER BY d.day
      ) sub
    ),
    'by_user_today', (
      SELECT COALESCE(json_agg(row_data), '[]'::json)
      FROM (
        SELECT json_build_object(
          'user_id', u.id,
          'user_name', u.name,
          'total_orders', SUM(ce.orders_count),
          'total_units', SUM(ce.units_count),
          'orders_per_hour', ROUND(SUM(ce.orders_count)::numeric / (GREATEST((v_end_date - v_start_date + 1), 1) * 8), 2),
          'units_per_hour', ROUND(SUM(ce.units_count)::numeric / (GREATEST((v_end_date - v_start_date + 1), 1) * 8), 2)
        ) AS row_data
        FROM crm_entries ce
        JOIN users u ON u.id = ce.user_id
        WHERE DATE(ce.created_at AT TIME ZONE 'Europe/Kyiv') BETWEEN v_start_date AND v_end_date
          AND (p_is_admin OR ce.user_id = p_user_id)
        GROUP BY u.id, u.name
      ) sub
    ),
    'monthly', (
      SELECT json_build_object(
        'total_orders', COALESCE(SUM(orders_count), 0),
        'total_units', COALESCE(SUM(units_count), 0)
      )
      FROM crm_entries
      WHERE DATE(created_at AT TIME ZONE 'Europe/Kyiv') BETWEEN DATE_TRUNC('month', v_anchor_date)::date
        AND LEAST(
          (DATE_TRUNC('month', v_anchor_date)::date + INTERVAL '1 month - 1 day')::date,
          v_today
        )
        AND (p_is_admin OR user_id = p_user_id)
    )
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
  v_month_start date := DATE_TRUNC('month', (now() AT TIME ZONE 'Europe/Kyiv')::date)::date;
  v_month_end date := (v_month_start + INTERVAL '1 month - 1 day')::date;
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
        'user_id', user_id,
        'user_name', user_name,
        'total_orders', total_orders_month,
        'total_bonus', total_bonus,
        'days_active', days_active
      ) AS row_data
      FROM (
        SELECT
          u.id AS user_id,
          u.name AS user_name,
          SUM(d.daily_orders) AS total_orders_month,
          COUNT(*) AS days_active,
          SUM(CASE
            WHEN d.daily_orders <= v_threshold THEN 0
            WHEN d.daily_orders <= 100 THEN (d.daily_orders - v_threshold) * v_rate_mid
            ELSE (d.daily_orders - v_threshold) * v_rate_high
          END) AS total_bonus
        FROM (
          SELECT
            ce.user_id,
            DATE(ce.created_at AT TIME ZONE 'Europe/Kyiv') AS day,
            SUM(ce.orders_count) AS daily_orders
          FROM crm_entries ce
          JOIN users u ON u.id = ce.user_id
          WHERE DATE(ce.created_at AT TIME ZONE 'Europe/Kyiv') BETWEEN v_month_start AND v_month_end
            AND u.role = 'crm'
            AND (p_is_admin OR ce.user_id = p_user_id)
          GROUP BY ce.user_id, DATE(ce.created_at AT TIME ZONE 'Europe/Kyiv')
        ) d
        JOIN users u ON u.id = d.user_id
        GROUP BY u.id, u.name
      ) agg
    ) sub
  );
END;
$$;
