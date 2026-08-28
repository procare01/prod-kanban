-- Treat Saturday and Sunday as weekend shifts with the Saturday-hour rate.
-- Rebuild the currently installed RPCs while preserving their existing access
-- rules and calculation logic.

DO $$
DECLARE
  v_function regprocedure;
  v_definition text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.set_crm_work_hours(uuid,text,uuid,date,numeric,numeric,numeric,numeric)'::regprocedure,
    'public.get_crm_work_hours_day(uuid,text,date)'::regprocedure,
    'public.get_crm_month_dashboard(uuid,text,date)'::regprocedure,
    'public.set_my_crm_work_hours(uuid,text,date,numeric,numeric,numeric,numeric)'::regprocedure,
    'public.get_my_crm_work_hours_day(uuid,text,date)'::regprocedure,
    'public.get_my_crm_month_dashboard(uuid,text,date)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_function) INTO v_definition;
    v_definition := REPLACE(v_definition, 'EXTRACT(ISODOW FROM p_date) <> 6', 'EXTRACT(ISODOW FROM p_date) NOT IN (6, 7)');
    v_definition := REPLACE(v_definition, 'EXTRACT(ISODOW FROM p_date) = 6', 'EXTRACT(ISODOW FROM p_date) IN (6, 7)');
    v_definition := REPLACE(v_definition, 'EXTRACT(ISODOW FROM h.work_date) = 6', 'EXTRACT(ISODOW FROM h.work_date) IN (6, 7)');
    v_definition := REPLACE(v_definition, 'EXTRACT(ISODOW FROM work_date) = 6', 'EXTRACT(ISODOW FROM work_date) IN (6, 7)');
    EXECUTE v_definition;
  END LOOP;
END;
$$;
