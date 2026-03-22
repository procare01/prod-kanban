-- ─── 016_crm_monthly_bonus.sql ───────────────────────────────────────────────
-- Per-user monthly bonus: sum of daily bonuses for current month
-- Bonus per day: 0-80 orders = 0, 81-100 = (n-80)*6, 101+ = (n-80)*8

CREATE OR REPLACE FUNCTION get_crm_monthly_bonus(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_data ORDER BY (row_data->>'total_bonus')::numeric DESC), '[]'::json)
    FROM (
      SELECT json_build_object(
        'user_id',      user_id,
        'user_name',    user_name,
        'total_orders', total_orders_month,
        'total_bonus',  total_bonus,
        'days_active',  days_active
      ) AS row_data
      FROM (
        SELECT
          u.id                              AS user_id,
          u.name                            AS user_name,
          SUM(d.daily_orders)               AS total_orders_month,
          COUNT(*)                          AS days_active,
          SUM(
            CASE
              WHEN d.daily_orders <= 80  THEN 0
              WHEN d.daily_orders <= 100 THEN (d.daily_orders - 80) * 6
              ELSE                            (d.daily_orders - 80) * 8
            END
          )                                 AS total_bonus
        FROM (
          SELECT
            ce.user_id,
            DATE(ce.created_at AT TIME ZONE 'UTC') AS day,
            SUM(ce.orders_count)                   AS daily_orders
          FROM crm_entries ce
          WHERE DATE_TRUNC('month', ce.created_at AT TIME ZONE 'UTC')
                = DATE_TRUNC('month', CURRENT_DATE)
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
