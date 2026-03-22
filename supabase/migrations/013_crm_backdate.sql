-- ─── 013_crm_backdate.sql ────────────────────────────────────────────────────
-- Allow submitting CRM entries for any date + fetch by date

-- Update submit to accept optional custom timestamp
CREATE OR REPLACE FUNCTION submit_crm_entry(
  p_user_id    uuid,
  p_orders     integer,
  p_units      integer,
  p_created_at timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id         uuid;
  v_created_at timestamptz;
BEGIN
  INSERT INTO crm_entries (user_id, orders_count, units_count, created_at)
  VALUES (p_user_id, p_orders, p_units, p_created_at)
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN json_build_object('id', v_id, 'created_at', v_created_at);
END;
$$;

-- Update get_crm_today to accept any date (default = today)
CREATE OR REPLACE FUNCTION get_crm_today(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false,
  p_date     date    DEFAULT CURRENT_DATE
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
  WHERE DATE(ce.created_at AT TIME ZONE 'UTC') = p_date
    AND (p_is_admin OR ce.user_id = p_user_id);

  RETURN COALESCE(v_result, '{"total_orders":0,"total_units":0,"entries":[]}'::json);
END;
$$;

-- Delete entry by id (for editing flow)
CREATE OR REPLACE FUNCTION delete_crm_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM crm_entries WHERE id = p_id;
END;
$$;
