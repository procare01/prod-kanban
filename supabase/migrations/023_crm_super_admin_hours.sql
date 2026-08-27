-- ─── 023_crm_super_admin_hours.sql ─────────────────────────────────────────
-- Super-admin editing, monthly work-hours accounting and a calendar-month
-- dashboard for the CRM warehouse.

CREATE TABLE IF NOT EXISTS crm_work_hours (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_start       date        NOT NULL,
  regular_hours     numeric(8,2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0),
  overtime_hours    numeric(8,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  overtime_coefficient numeric(3,1) NOT NULL DEFAULT 1.5 CHECK (overtime_coefficient IN (1.0, 1.2, 1.5, 2.0)),
  saturday_hours    numeric(8,2) NOT NULL DEFAULT 0 CHECK (saturday_hours >= 0),
  saturdays_worked  integer     NOT NULL DEFAULT 0 CHECK (saturdays_worked >= 0),
  updated_by        uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month_start),
  CHECK (month_start = DATE_TRUNC('month', month_start)::date)
);

-- Keep the migration safe when crm_work_hours was created by an earlier draft.
ALTER TABLE crm_work_hours
  ADD COLUMN IF NOT EXISTS overtime_coefficient numeric(3,1) NOT NULL DEFAULT 1.5
  CHECK (overtime_coefficient IN (1.0, 1.2, 1.5, 2.0));

CREATE INDEX IF NOT EXISTS crm_work_hours_month_idx
  ON crm_work_hours (month_start, user_id);

-- The app uses a PIN-based user model rather than Supabase Auth. Every
-- privileged CRM RPC therefore validates both the caller id and the dedicated
-- CRM super-admin password requested for this screen.
CREATE OR REPLACE FUNCTION assert_crm_super_admin(
  p_admin_id  uuid,
  p_admin_pin text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_admin_pin IS DISTINCT FROM '1505' OR NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_admin_id
      AND (u.role = 'super_admin' OR (u.role = 'admin' AND u.pin = '1505'))
  ) THEN
    RAISE EXCEPTION 'CRM_SUPER_ADMIN_REQUIRED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_workers(
  p_admin_id  uuid,
  p_admin_pin text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  RETURN (
    SELECT COALESCE(
      json_agg(
        json_build_object('id', u.id, 'name', u.name, 'role', u.role)
        ORDER BY u.name
      ),
      '[]'::json
    )
    FROM users u
    WHERE u.role IN ('crm', 'crm_admin')
  );
END;
$$;

CREATE OR REPLACE FUNCTION submit_crm_entry_as_super_admin(
  p_admin_id  uuid,
  p_admin_pin text,
  p_user_id   uuid,
  p_orders    integer,
  p_units     integer,
  p_created_at timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
  v_created_at timestamptz;
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  IF p_orders < 0 OR p_units < 0 OR NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_user_id AND role IN ('crm', 'crm_admin')
  ) THEN
    RAISE EXCEPTION 'INVALID_CRM_ENTRY';
  END IF;

  INSERT INTO crm_entries (user_id, orders_count, units_count, created_at)
  VALUES (p_user_id, p_orders, p_units, p_created_at)
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN json_build_object('id', v_id, 'created_at', v_created_at);
END;
$$;

CREATE OR REPLACE FUNCTION update_crm_entry_as_super_admin(
  p_admin_id  uuid,
  p_admin_pin text,
  p_entry_id  uuid,
  p_orders    integer,
  p_units     integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  IF p_orders < 0 OR p_units < 0 THEN
    RAISE EXCEPTION 'INVALID_CRM_ENTRY';
  END IF;

  UPDATE crm_entries
  SET orders_count = p_orders,
      units_count = p_units
  WHERE id = p_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM_ENTRY_NOT_FOUND';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION delete_crm_entry_as_super_admin(
  p_admin_id  uuid,
  p_admin_pin text,
  p_entry_id  uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);
  DELETE FROM crm_entries WHERE id = p_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_crm_work_hours(
  p_admin_id         uuid,
  p_admin_pin        text,
  p_user_id          uuid,
  p_month            date,
  p_regular_hours    numeric,
  p_overtime_hours   numeric,
  p_overtime_coefficient numeric,
  p_saturday_hours   numeric,
  p_saturdays_worked integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month date := DATE_TRUNC('month', p_month)::date;
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  IF p_regular_hours < 0 OR p_overtime_hours < 0 OR p_saturday_hours < 0
     OR p_overtime_coefficient NOT IN (1.0, 1.2, 1.5, 2.0)
     OR p_saturdays_worked < 0 OR NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_user_id AND role IN ('crm', 'crm_admin')
     ) THEN
    RAISE EXCEPTION 'INVALID_CRM_WORK_HOURS';
  END IF;

  INSERT INTO crm_work_hours (
    user_id, month_start, regular_hours, overtime_hours, overtime_coefficient,
    saturday_hours, saturdays_worked, updated_by, updated_at
  ) VALUES (
    p_user_id, v_month, p_regular_hours, p_overtime_hours, p_overtime_coefficient,
    p_saturday_hours, p_saturdays_worked, p_admin_id, now()
  )
  ON CONFLICT (user_id, month_start) DO UPDATE SET
    regular_hours = EXCLUDED.regular_hours,
    overtime_hours = EXCLUDED.overtime_hours,
    overtime_coefficient = EXCLUDED.overtime_coefficient,
    saturday_hours = EXCLUDED.saturday_hours,
    saturdays_worked = EXCLUDED.saturdays_worked,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_month_dashboard(
  p_admin_id  uuid,
  p_admin_pin text,
  p_month     date
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month_start date := DATE_TRUNC('month', p_month)::date;
  v_month_end date := (DATE_TRUNC('month', p_month) + INTERVAL '1 month - 1 day')::date;
  v_threshold integer := 80;
  v_rate_mid integer := 6;
  v_rate_high integer := 8;
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  SELECT threshold, rate_mid, rate_high
  INTO v_threshold, v_rate_mid, v_rate_high
  FROM crm_bonus_settings
  LIMIT 1;

  RETURN (
    WITH daily AS (
      SELECT
        ce.user_id,
        DATE(ce.created_at AT TIME ZONE 'UTC') AS work_day,
        SUM(ce.orders_count)::integer AS orders,
        SUM(ce.units_count)::integer AS units
      FROM crm_entries ce
      WHERE DATE(ce.created_at AT TIME ZONE 'UTC') BETWEEN v_month_start AND v_month_end
      GROUP BY ce.user_id, DATE(ce.created_at AT TIME ZONE 'UTC')
    ),
    performance AS (
      SELECT
        d.user_id,
        SUM(d.orders)::integer AS total_orders,
        SUM(d.units)::integer AS total_units,
        COUNT(*)::integer AS days_active,
        SUM(
          CASE
            WHEN d.orders <= v_threshold THEN 0
            WHEN d.orders <= 100 THEN (d.orders - v_threshold) * v_rate_mid
            ELSE (d.orders - v_threshold) * v_rate_high
          END
        )::integer AS total_bonus
      FROM daily d
      GROUP BY d.user_id
    ),
    rows AS (
      SELECT
        u.id AS user_id,
        u.name AS user_name,
        COALESCE(p.total_orders, 0) AS total_orders,
        COALESCE(p.total_units, 0) AS total_units,
        COALESCE(p.days_active, 0) AS days_active,
        COALESCE(p.total_bonus, 0) AS total_bonus,
        COALESCE(h.regular_hours, 0) AS regular_hours,
        COALESCE(h.overtime_hours, 0) AS overtime_hours,
        COALESCE(h.overtime_coefficient, 1.5) AS overtime_coefficient,
        COALESCE(h.saturday_hours, 0) AS saturday_hours,
        COALESCE(h.saturdays_worked, 0) AS saturdays_worked,
        CASE
          WHEN COALESCE(h.saturdays_worked, 0) >= 3 THEN 1.5
          WHEN COALESCE(h.saturdays_worked, 0) >= 1 THEN 1.2
          ELSE 1.0
        END AS saturday_coefficient,
        ROUND(
          COALESCE(h.regular_hours, 0)
          + COALESCE(h.overtime_hours, 0) * COALESCE(h.overtime_coefficient, 1.5)
          + COALESCE(h.saturday_hours, 0) * CASE
              WHEN COALESCE(h.saturdays_worked, 0) >= 3 THEN 1.5
              WHEN COALESCE(h.saturdays_worked, 0) >= 1 THEN 1.2
              ELSE 1.0
            END,
          2
        ) AS weighted_hours
      FROM users u
      LEFT JOIN performance p ON p.user_id = u.id
      LEFT JOIN crm_work_hours h
        ON h.user_id = u.id AND h.month_start = v_month_start
      WHERE u.role IN ('crm', 'crm_admin')
    )
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'user_id', user_id,
          'user_name', user_name,
          'total_orders', total_orders,
          'total_units', total_units,
          'days_active', days_active,
          'total_bonus', total_bonus,
          'regular_hours', regular_hours,
          'overtime_hours', overtime_hours,
          'overtime_coefficient', overtime_coefficient,
          'saturday_hours', saturday_hours,
          'saturdays_worked', saturdays_worked,
          'saturday_coefficient', saturday_coefficient,
          'weighted_hours', weighted_hours
        ) ORDER BY user_name
      ),
      '[]'::json
    )
    FROM rows
  );
END;
$$;
