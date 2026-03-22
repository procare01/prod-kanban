-- ─── 012_crm.sql ─────────────────────────────────────────────────────────────
-- Adds CRM role, crm_entries table, and all required RPCs

-- 1. Allow 'crm' as a valid role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('brigadir', 'controller', 'admin', 'crm'));

-- 2. CRM entries table
CREATE TABLE IF NOT EXISTS crm_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  orders_count integer     NOT NULL DEFAULT 0 CHECK (orders_count >= 0),
  units_count  integer     NOT NULL DEFAULT 0 CHECK (units_count >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_entries_user_id_idx    ON crm_entries (user_id);
CREATE INDEX IF NOT EXISTS crm_entries_created_at_idx ON crm_entries (created_at);

-- ─── RPCs ─────────────────────────────────────────────────────────────────────

-- Submit a new CRM entry
CREATE OR REPLACE FUNCTION submit_crm_entry(
  p_user_id uuid,
  p_orders  integer,
  p_units   integer
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id         uuid;
  v_created_at timestamptz;
BEGIN
  INSERT INTO crm_entries (user_id, orders_count, units_count)
  VALUES (p_user_id, p_orders, p_units)
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN json_build_object('id', v_id, 'created_at', v_created_at);
END;
$$;

-- Get today's CRM data (user sees own; admin sees all)
CREATE OR REPLACE FUNCTION get_crm_today(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'total_orders', COALESCE(SUM(ce.orders_count), 0),
    'total_units',  COALESCE(SUM(ce.units_count),  0),
    'entries', COALESCE(
      json_agg(
        json_build_object(
          'id',           ce.id,
          'user_id',      ce.user_id,
          'user_name',    u.name,
          'orders_count', ce.orders_count,
          'units_count',  ce.units_count,
          'created_at',   ce.created_at
        ) ORDER BY ce.created_at DESC
      ),
      '[]'::json
    )
  )
  INTO v_result
  FROM crm_entries ce
  JOIN users u ON u.id = ce.user_id
  WHERE DATE(ce.created_at AT TIME ZONE 'UTC') = CURRENT_DATE
    AND (p_is_admin OR ce.user_id = p_user_id);

  RETURN COALESCE(v_result, '{"total_orders":0,"total_units":0,"entries":[]}'::json);
END;
$$;

-- Get CRM analytics: daily chart + per-user KPI for today
CREATE OR REPLACE FUNCTION get_crm_analytics(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false,
  p_days     integer DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN json_build_object(

    -- daily series (for 7d / 30d charts)
    'daily', (
      SELECT COALESCE(json_agg(row_data ORDER BY (row_data->>'date')), '[]'::json)
      FROM (
        SELECT json_build_object(
          'date',   TO_CHAR(d.day, 'YYYY-MM-DD'),
          'orders', COALESCE(SUM(ce.orders_count), 0),
          'units',  COALESCE(SUM(ce.units_count),  0)
        ) AS row_data
        FROM generate_series(
          CURRENT_DATE - (p_days - 1) * INTERVAL '1 day',
          CURRENT_DATE,
          INTERVAL '1 day'
        ) AS d(day)
        LEFT JOIN crm_entries ce
          ON DATE(ce.created_at AT TIME ZONE 'UTC') = d.day
          AND (p_is_admin OR ce.user_id = p_user_id)
        GROUP BY d.day
        ORDER BY d.day
      ) sub
    ),

    -- per-user KPI for today (orders/8h, units/8h)
    'by_user_today', (
      SELECT COALESCE(json_agg(row_data), '[]'::json)
      FROM (
        SELECT json_build_object(
          'user_id',         u.id,
          'user_name',       u.name,
          'total_orders',    SUM(ce.orders_count),
          'total_units',     SUM(ce.units_count),
          'orders_per_hour', ROUND(SUM(ce.orders_count)::numeric / 8, 2),
          'units_per_hour',  ROUND(SUM(ce.units_count)::numeric / 8, 2)
        ) AS row_data
        FROM crm_entries ce
        JOIN users u ON u.id = ce.user_id
        WHERE DATE(ce.created_at AT TIME ZONE 'UTC') = CURRENT_DATE
          AND (p_is_admin OR ce.user_id = p_user_id)
        GROUP BY u.id, u.name
      ) sub
    ),

    -- monthly totals
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

-- Delete a CRM entry (admin only enforced in UI)
CREATE OR REPLACE FUNCTION delete_crm_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM crm_entries WHERE id = p_id;
END;
$$;
