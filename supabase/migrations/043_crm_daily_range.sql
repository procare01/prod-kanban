-- Return one point per Kyiv calendar day for the CRM graph.
-- This replaces one get_crm_today RPC call per day in the client.

CREATE OR REPLACE FUNCTION get_crm_daily_range(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_start_date date DEFAULT ((now() AT TIME ZONE 'Europe/Kyiv')::date),
  p_end_date date DEFAULT ((now() AT TIME ZONE 'Europe/Kyiv')::date)
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
  v_start_date date := LEAST(p_start_date, p_end_date);
  v_end_date date := LEAST(GREATEST(p_start_date, p_end_date), v_today);
BEGIN
  IF v_end_date < v_start_date THEN
    RETURN '[]'::json;
  END IF;

  IF v_end_date - v_start_date > 209 THEN
    RAISE EXCEPTION 'CRM_DATE_RANGE_TOO_LARGE';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_data ORDER BY row_data->>'date'), '[]'::json)
    FROM (
      SELECT json_build_object(
        'date', TO_CHAR(d.day, 'YYYY-MM-DD'),
        'orders', COALESCE(SUM(ce.orders_count), 0),
        'units', COALESCE(SUM(ce.units_count), 0)
      ) AS row_data
      FROM generate_series(v_start_date, v_end_date, INTERVAL '1 day') AS d(day)
      LEFT JOIN crm_entries ce
        ON DATE(ce.created_at AT TIME ZONE 'Europe/Kyiv') = d.day::date
        AND (p_is_admin OR ce.user_id = p_user_id)
      GROUP BY d.day
      ORDER BY d.day
    ) AS daily
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_crm_daily_range(uuid, boolean, date, date) TO anon, authenticated;
