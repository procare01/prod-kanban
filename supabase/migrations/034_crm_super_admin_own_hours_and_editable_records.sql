-- Keep Ігор Яблонський (the CRM super administrator) in the hours roster
-- for his own hours, while preserving CRM-only access for everyone else.

DO $$
DECLARE
  v_function regprocedure;
  v_definition text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.get_crm_workers(uuid,text)'::regprocedure,
    'public.set_crm_work_hours(uuid,text,uuid,date,numeric,numeric,numeric,numeric)'::regprocedure,
    'public.get_crm_work_hours_day(uuid,text,date)'::regprocedure,
    'public.get_crm_month_dashboard(uuid,text,date)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_function) INTO v_definition;
    IF v_function = 'public.get_crm_workers(uuid,text)'::regprocedure THEN
      v_definition := REPLACE(
        v_definition,
        'WHERE u.role = ''crm''',
        'WHERE u.role = ''crm'' OR (u.id = p_admin_id AND u.role = ''super_admin'' AND u.name = ''Ігор Яблонський'')'
      );
    ELSE
      v_definition := REPLACE(
        v_definition,
        'WHERE u.role = ''crm''',
        'WHERE u.role = ''crm'' OR (u.role = ''super_admin'' AND u.name = ''Ігор Яблонський'')'
      );
    END IF;
    v_definition := REPLACE(
      v_definition,
      'id = p_user_id AND role = ''crm''',
      'id = p_user_id AND (role = ''crm'' OR (id = p_admin_id AND role = ''super_admin'' AND name = ''Ігор Яблонський''))'
    );
    EXECUTE v_definition;
  END LOOP;
END;
$$;

-- Distinguish order records from hour-only records so the super administrator
-- can edit the appropriate values directly from the records screen.
CREATE OR REPLACE FUNCTION get_crm_recent(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_limit integer DEFAULT 250
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    WITH source_rows AS (
      SELECT
        ce.id,
        'entry'::text AS record_type,
        ce.user_id,
        u.name AS user_name,
        ce.orders_count,
        ce.units_count,
        ce.created_at,
        COALESCE(h.work_date, DATE(ce.created_at AT TIME ZONE 'UTC')) AS work_date,
        h.regular_hours,
        h.overtime_hours,
        h.overtime_coefficient,
        h.saturday_hours
      FROM crm_entries ce
      JOIN users u ON u.id = ce.user_id
      LEFT JOIN crm_work_hours_daily h
        ON h.user_id = ce.user_id
        AND h.work_date = DATE(ce.created_at AT TIME ZONE 'UTC')
      WHERE (u.role = 'crm' OR (u.role = 'super_admin' AND u.name = 'Ігор Яблонський'))
        AND DATE(ce.created_at AT TIME ZONE 'UTC') >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date
        AND (p_is_admin OR ce.user_id = p_user_id)

      UNION ALL

      SELECT
        h.id,
        'hours'::text AS record_type,
        h.user_id,
        u.name AS user_name,
        0 AS orders_count,
        0 AS units_count,
        h.updated_at AS created_at,
        h.work_date,
        h.regular_hours,
        h.overtime_hours,
        h.overtime_coefficient,
        h.saturday_hours
      FROM crm_work_hours_daily h
      JOIN users u ON u.id = h.user_id
      WHERE (u.role = 'crm' OR (u.role = 'super_admin' AND u.name = 'Ігор Яблонський'))
        AND h.work_date >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date
        AND (h.regular_hours > 0 OR h.overtime_hours > 0 OR h.saturday_hours > 0)
        AND NOT EXISTS (
          SELECT 1
          FROM crm_entries ce
          WHERE ce.user_id = h.user_id
            AND DATE(ce.created_at AT TIME ZONE 'UTC') = h.work_date
        )
        AND (p_is_admin OR h.user_id = p_user_id)
    )
    SELECT COALESCE(json_agg(row_data), '[]'::json)
    FROM (
      SELECT json_build_object(
        'id', row.id,
        'record_type', row.record_type,
        'user_id', row.user_id,
        'user_name', row.user_name,
        'orders_count', row.orders_count,
        'units_count', row.units_count,
        'created_at', row.created_at,
        'work_date', row.work_date,
        'regular_hours', COALESCE(row.regular_hours, 0),
        'overtime_hours', COALESCE(row.overtime_hours, 0),
        'overtime_coefficient', COALESCE(row.overtime_coefficient, 2),
        'saturday_hours', COALESCE(row.saturday_hours, 0),
        'weighted_hours', ROUND(
          COALESCE(row.regular_hours, 0)
          + COALESCE(row.overtime_hours, 0) * COALESCE(row.overtime_coefficient, 2)
          + COALESCE(row.saturday_hours, 0) * CASE
              WHEN COALESCE(row.saturday_hours, 0) = 0 THEN 1.0
              WHEN (
                SELECT COUNT(*)
                FROM crm_work_hours_daily previous_h
                WHERE previous_h.user_id = row.user_id
                  AND previous_h.work_date >= DATE_TRUNC('month', row.work_date)::date
                  AND previous_h.work_date <= row.work_date
                  AND EXTRACT(ISODOW FROM previous_h.work_date) IN (6, 7)
                  AND previous_h.saturday_hours > 0
              ) >= 3 THEN 1.5
              ELSE 1.2
            END,
          2
        )
      ) AS row_data,
      row.created_at
      FROM source_rows row
      ORDER BY row.created_at DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 500)
    ) recent_rows
  );
END;
$$;
