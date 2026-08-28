-- Include days with work hours but no order entry in the CRM records feed.
-- This lets crm_admin see a worker's saved hours even when only hours were entered.

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
        ce.user_id,
        u.name AS user_name,
        ce.orders_count,
        ce.units_count,
        ce.created_at,
        h.work_date,
        h.regular_hours,
        h.overtime_hours,
        h.overtime_coefficient,
        h.saturday_hours
      FROM crm_entries ce
      JOIN users u ON u.id = ce.user_id
      LEFT JOIN crm_work_hours_daily h
        ON h.user_id = ce.user_id
        AND h.work_date = DATE(ce.created_at AT TIME ZONE 'UTC')
      WHERE u.role = 'crm'
        AND DATE(ce.created_at AT TIME ZONE 'UTC') >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date
        AND (p_is_admin OR ce.user_id = p_user_id)

      UNION ALL

      SELECT
        h.id,
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
      WHERE u.role = 'crm'
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
        'user_id', row.user_id,
        'user_name', row.user_name,
        'orders_count', row.orders_count,
        'units_count', row.units_count,
        'created_at', row.created_at,
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
