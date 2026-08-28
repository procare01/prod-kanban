-- The review screen lists entries from the current and immediately preceding
-- calendar months, instead of an arbitrary short recent list.

CREATE OR REPLACE FUNCTION get_crm_recent(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false,
  p_limit integer DEFAULT 250
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_data), '[]'::json)
    FROM (
      SELECT json_build_object(
        'id', ce.id,
        'user_id', ce.user_id,
        'user_name', u.name,
        'orders_count', ce.orders_count,
        'units_count', ce.units_count,
        'created_at', ce.created_at,
        'weighted_hours', ROUND(
          COALESCE(h.regular_hours, 0)
          + COALESCE(h.overtime_hours, 0) * COALESCE(h.overtime_coefficient, 2)
          + COALESCE(h.saturday_hours, 0) * CASE
              WHEN COALESCE(h.saturday_hours, 0) = 0 THEN 1.0
              WHEN (
                SELECT COUNT(*) FROM crm_work_hours_daily previous_h
                WHERE previous_h.user_id = ce.user_id
                  AND previous_h.work_date >= DATE_TRUNC('month', h.work_date)::date
                  AND previous_h.work_date <= h.work_date
                  AND EXTRACT(ISODOW FROM previous_h.work_date) IN (6, 7)
                  AND previous_h.saturday_hours > 0
              ) >= 3 THEN 1.5 ELSE 1.2
            END,
          2
        )
      ) AS row_data
      FROM crm_entries ce
      JOIN users u ON u.id = ce.user_id
      LEFT JOIN crm_work_hours_daily h
        ON h.user_id = ce.user_id AND h.work_date = DATE(ce.created_at AT TIME ZONE 'UTC')
      WHERE u.role = 'crm'
        AND DATE(ce.created_at AT TIME ZONE 'UTC') >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date
        AND (p_is_admin OR ce.user_id = p_user_id)
      ORDER BY ce.created_at DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 500)
    ) sub
  );
END;
$$;
