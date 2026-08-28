-- ─── 025_crm_daily_work_hours.sql ──────────────────────────────────────────
-- Store CRM work hours per calendar day and build month totals from daily rows.

CREATE TABLE IF NOT EXISTS crm_work_hours_daily (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date              date         NOT NULL,
  regular_hours          numeric(8,2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0),
  overtime_hours         numeric(8,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  overtime_coefficient   numeric(3,1) NOT NULL DEFAULT 1.5 CHECK (overtime_coefficient IN (1.0, 1.2, 1.5, 2.0)),
  saturday_hours         numeric(8,2) NOT NULL DEFAULT 0 CHECK (saturday_hours >= 0),
  updated_by             uuid         REFERENCES users(id) ON DELETE SET NULL,
  updated_at             timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS crm_work_hours_daily_date_idx
  ON crm_work_hours_daily (work_date, user_id);

-- Replaces the former month-level RPC with a daily entry RPC.
DROP FUNCTION IF EXISTS set_crm_work_hours(
  uuid, text, uuid, date, numeric, numeric, numeric, numeric, integer
);

CREATE OR REPLACE FUNCTION set_crm_work_hours(
  p_admin_id              uuid,
  p_admin_pin             text,
  p_user_id               uuid,
  p_date                  date,
  p_regular_hours         numeric,
  p_overtime_hours        numeric,
  p_overtime_coefficient  numeric,
  p_saturday_hours        numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  IF p_date > CURRENT_DATE
     OR p_regular_hours < 0 OR p_overtime_hours < 0 OR p_saturday_hours < 0
     OR p_overtime_coefficient NOT IN (1.0, 1.2, 1.5, 2.0)
     OR (EXTRACT(ISODOW FROM p_date) NOT IN (6, 7) AND p_saturday_hours <> 0)
     OR NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_user_id AND role = 'crm'
     ) THEN
    RAISE EXCEPTION 'INVALID_CRM_WORK_HOURS';
  END IF;

  INSERT INTO crm_work_hours_daily (
    user_id, work_date, regular_hours, overtime_hours,
    overtime_coefficient, saturday_hours, updated_by, updated_at
  ) VALUES (
    p_user_id, p_date, p_regular_hours, p_overtime_hours,
    p_overtime_coefficient, p_saturday_hours, p_admin_id, now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE SET
    regular_hours = EXCLUDED.regular_hours,
    overtime_hours = EXCLUDED.overtime_hours,
    overtime_coefficient = EXCLUDED.overtime_coefficient,
    saturday_hours = EXCLUDED.saturday_hours,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_work_hours_day(
  p_admin_id  uuid,
  p_admin_pin text,
  p_date      date
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month_start date := DATE_TRUNC('month', p_date)::date;
BEGIN
  PERFORM assert_crm_super_admin(p_admin_id, p_admin_pin);

  RETURN (
    WITH previous_saturdays AS (
      SELECT
        h.user_id,
        COUNT(*)::integer AS saturday_count
      FROM crm_work_hours_daily h
      WHERE h.work_date >= v_month_start
        AND h.work_date < p_date
        AND EXTRACT(ISODOW FROM h.work_date) IN (6, 7)
        AND h.saturday_hours > 0
      GROUP BY h.user_id
    )
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'user_id', u.id,
          'user_name', u.name,
          'work_date', p_date,
          'regular_hours', COALESCE(h.regular_hours, 0),
          'overtime_hours', COALESCE(h.overtime_hours, 0),
          'overtime_coefficient', COALESCE(h.overtime_coefficient, 1.5),
          'saturday_hours', COALESCE(h.saturday_hours, 0),
          'saturday_number', CASE
            WHEN EXTRACT(ISODOW FROM p_date) IN (6, 7) THEN COALESCE(ps.saturday_count, 0) + 1
            ELSE 0
          END,
          'saturday_coefficient', CASE
            WHEN EXTRACT(ISODOW FROM p_date) NOT IN (6, 7) THEN 1.0
            WHEN COALESCE(ps.saturday_count, 0) >= 2 THEN 1.5
            ELSE 1.2
          END,
          'weighted_hours', ROUND(
            COALESCE(h.regular_hours, 0)
            + COALESCE(h.overtime_hours, 0) * COALESCE(h.overtime_coefficient, 1.5)
            + COALESCE(h.saturday_hours, 0) * CASE
                WHEN EXTRACT(ISODOW FROM p_date) NOT IN (6, 7) THEN 1.0
                WHEN COALESCE(ps.saturday_count, 0) >= 2 THEN 1.5
                ELSE 1.2
              END,
            2
          )
        ) ORDER BY u.name
      ),
      '[]'::json
    )
    FROM users u
    LEFT JOIN crm_work_hours_daily h ON h.user_id = u.id AND h.work_date = p_date
    LEFT JOIN previous_saturdays ps ON ps.user_id = u.id
    WHERE u.role = 'crm'
  );
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
        SUM(CASE
          WHEN d.orders <= v_threshold THEN 0
          WHEN d.orders <= 100 THEN (d.orders - v_threshold) * v_rate_mid
          ELSE (d.orders - v_threshold) * v_rate_high
        END)::integer AS total_bonus
      FROM daily d
      GROUP BY d.user_id
    ),
    month_hours AS (
      SELECT *
      FROM crm_work_hours_daily
      WHERE work_date BETWEEN v_month_start AND v_month_end
    ),
    saturday_ranked AS (
      SELECT
        user_id,
        work_date,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY work_date)::integer AS saturday_number
      FROM month_hours
      WHERE EXTRACT(ISODOW FROM work_date) IN (6, 7) AND saturday_hours > 0
    ),
    hours AS (
      SELECT
        h.user_id,
        SUM(h.regular_hours) AS regular_hours,
        SUM(h.overtime_hours) AS overtime_hours,
        SUM(h.saturday_hours) AS saturday_hours,
        COUNT(sr.saturday_number)::integer AS saturdays_worked,
        SUM(
          h.regular_hours
          + h.overtime_hours * h.overtime_coefficient
          + h.saturday_hours * CASE WHEN COALESCE(sr.saturday_number, 0) >= 3 THEN 1.5 ELSE 1.2 END
        ) AS weighted_hours
      FROM month_hours h
      LEFT JOIN saturday_ranked sr ON sr.user_id = h.user_id AND sr.work_date = h.work_date
      GROUP BY h.user_id
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
        0::numeric AS overtime_coefficient,
        COALESCE(h.saturday_hours, 0) AS saturday_hours,
        COALESCE(h.saturdays_worked, 0) AS saturdays_worked,
        CASE WHEN COALESCE(h.saturdays_worked, 0) >= 3 THEN 1.5 WHEN COALESCE(h.saturdays_worked, 0) >= 1 THEN 1.2 ELSE 1.0 END AS saturday_coefficient,
        ROUND(COALESCE(h.weighted_hours, 0), 2) AS weighted_hours
      FROM users u
      LEFT JOIN performance p ON p.user_id = u.id
      LEFT JOIN hours h ON h.user_id = u.id
      WHERE u.role = 'crm'
    )
    SELECT COALESCE(
      json_agg(json_build_object(
        'user_id', user_id, 'user_name', user_name,
        'total_orders', total_orders, 'total_units', total_units,
        'days_active', days_active, 'total_bonus', total_bonus,
        'regular_hours', regular_hours, 'overtime_hours', overtime_hours,
        'overtime_coefficient', overtime_coefficient,
        'saturday_hours', saturday_hours, 'saturdays_worked', saturdays_worked,
        'saturday_coefficient', saturday_coefficient, 'weighted_hours', weighted_hours
      ) ORDER BY user_name),
      '[]'::json
    )
    FROM rows
  );
END;
$$;
