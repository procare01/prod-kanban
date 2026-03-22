-- ─── 017_crm_bonus_settings.sql ─────────────────────────────────────────────
-- Configurable bonus rates for CRM orders
-- rate_mid: UAH per order for 81–100 orders/day
-- rate_high: UAH per order for 101+ orders/day (counted from threshold)

CREATE TABLE IF NOT EXISTS crm_bonus_settings (
  id      boolean PRIMARY KEY DEFAULT true CHECK (id),
  threshold  integer NOT NULL DEFAULT 80,
  rate_mid   integer NOT NULL DEFAULT 6,
  rate_high  integer NOT NULL DEFAULT 8
);

INSERT INTO crm_bonus_settings DEFAULT VALUES ON CONFLICT DO NOTHING;

-- Get current settings
CREATE OR REPLACE FUNCTION get_crm_bonus_settings()
RETURNS json
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT row_to_json(s) FROM crm_bonus_settings s LIMIT 1;
$$;

-- Update rates (admin only, enforced in app layer)
CREATE OR REPLACE FUNCTION set_crm_bonus_settings(
  p_rate_mid  integer,
  p_rate_high integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE crm_bonus_settings SET rate_mid = p_rate_mid, rate_high = p_rate_high;
END;
$$;

-- Rebuild get_crm_monthly_bonus to use dynamic rates from crm_bonus_settings
CREATE OR REPLACE FUNCTION get_crm_monthly_bonus(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_threshold integer;
  v_rate_mid  integer;
  v_rate_high integer;
BEGIN
  SELECT threshold, rate_mid, rate_high
    INTO v_threshold, v_rate_mid, v_rate_high
  FROM crm_bonus_settings LIMIT 1;

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
              WHEN d.daily_orders <= v_threshold  THEN 0
              WHEN d.daily_orders <= 100          THEN (d.daily_orders - v_threshold) * v_rate_mid
              ELSE                                     (d.daily_orders - v_threshold) * v_rate_high
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
