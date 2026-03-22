-- ─── 014_crm_recent.sql ──────────────────────────────────────────────────────
-- Returns last N CRM entries for a user (or all users for admin)

CREATE OR REPLACE FUNCTION get_crm_recent(
  p_user_id  uuid,
  p_is_admin boolean DEFAULT false,
  p_limit    integer DEFAULT 40
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_data), '[]'::json)
    FROM (
      SELECT json_build_object(
        'id',           ce.id,
        'user_id',      ce.user_id,
        'user_name',    u.name,
        'orders_count', ce.orders_count,
        'units_count',  ce.units_count,
        'created_at',   ce.created_at
      ) AS row_data
      FROM crm_entries ce
      JOIN users u ON u.id = ce.user_id
      WHERE (p_is_admin OR ce.user_id = p_user_id)
      ORDER BY ce.created_at DESC
      LIMIT p_limit
    ) sub
  );
END;
$$;
