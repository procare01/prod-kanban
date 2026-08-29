-- Once a worker has three weekend shifts in a month, every weekend shift
-- in that month is paid at 1.5, including the earlier ones.

CREATE OR REPLACE FUNCTION crm_weekend_coefficient(
  p_user_id uuid,
  p_work_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN COUNT(*) >= 3 THEN 1.5 ELSE 1.2 END
  FROM crm_work_hours_daily h
  WHERE h.user_id = p_user_id
    AND h.work_date >= DATE_TRUNC('month', p_work_date)::date
    AND h.work_date < (DATE_TRUNC('month', p_work_date) + INTERVAL '1 month')::date
    AND EXTRACT(ISODOW FROM h.work_date) IN (6, 7)
    AND h.saturday_hours > 0;
$$;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_crm_month_dashboard(uuid,text,date)'::regprocedure)
  INTO v_definition;
  IF POSITION('CASE WHEN COALESCE(sr.saturday_number, 0) >= 3 THEN 1.5 ELSE 1.2 END' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'CRM_WEEKEND_RATE_PATTERN_NOT_FOUND';
  END IF;
  v_definition := REPLACE(
    v_definition,
    'CASE WHEN COALESCE(sr.saturday_number, 0) >= 3 THEN 1.5 ELSE 1.2 END',
    'public.crm_weekend_coefficient(h.user_id, h.work_date)'
  );
  EXECUTE v_definition;

  SELECT pg_get_functiondef('public.get_my_crm_month_dashboard(uuid,text,date)'::regprocedure)
  INTO v_definition;
  IF POSITION('CASE WHEN COALESCE(sr.saturday_number, 0) >= 3 THEN 1.5 ELSE 1.2 END' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'MY_CRM_WEEKEND_RATE_PATTERN_NOT_FOUND';
  END IF;
  v_definition := REPLACE(
    v_definition,
    'CASE WHEN COALESCE(sr.saturday_number, 0) >= 3 THEN 1.5 ELSE 1.2 END',
    'public.crm_weekend_coefficient(h.user_id, h.work_date)'
  );
  EXECUTE v_definition;

  SELECT pg_get_functiondef('public.get_crm_work_hours_day(uuid,text,date)'::regprocedure)
  INTO v_definition;
  IF POSITION('WHEN COALESCE(ps.saturday_count, 0) >= 2 THEN 1.5' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'CRM_DAY_WEEKEND_RATE_PATTERN_NOT_FOUND';
  END IF;
  v_definition := REPLACE(
    v_definition,
    'WHEN COALESCE(ps.saturday_count, 0) >= 2 THEN 1.5',
    'WHEN public.crm_weekend_coefficient(u.id, p_date) = 1.5 THEN 1.5'
  );
  EXECUTE v_definition;

  SELECT pg_get_functiondef('public.get_my_crm_work_hours_day(uuid,text,date)'::regprocedure)
  INTO v_definition;
  IF POSITION('WHEN ps.saturday_count >= 2 THEN 1.5' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'MY_CRM_DAY_WEEKEND_RATE_PATTERN_NOT_FOUND';
  END IF;
  v_definition := REPLACE(
    v_definition,
    'WHEN ps.saturday_count >= 2 THEN 1.5',
    'WHEN public.crm_weekend_coefficient(u.id, p_date) = 1.5 THEN 1.5'
  );
  EXECUTE v_definition;

  SELECT pg_get_functiondef('public.get_crm_recent(uuid,boolean,integer)'::regprocedure)
  INTO v_definition;
  IF POSITION('AND previous_h.work_date <= row.work_date' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'CRM_RECENT_WEEKEND_RATE_PATTERN_NOT_FOUND';
  END IF;
  v_definition := REPLACE(
    v_definition,
    'AND previous_h.work_date <= row.work_date',
    'AND previous_h.work_date < (DATE_TRUNC(''month'', row.work_date) + INTERVAL ''1 month'')::date'
  );
  EXECUTE v_definition;
END;
$$;
