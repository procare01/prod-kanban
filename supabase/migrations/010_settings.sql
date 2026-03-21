-- ============================================================
-- SETTINGS TABLE: work schedule + webhook URL
-- ============================================================

create table if not exists settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz default now()
);

-- Default values (only insert if row doesn't exist)
insert into settings (key, value) values
  ('work_start',  '08:00'),
  ('work_end',    '18:00'),
  ('webhook_url', '')
on conflict (key) do nothing;

grant all on table settings to anon, authenticated;

-- Get all settings as a JSON object: { "work_start": "08:00", ... }
create or replace function get_settings()
returns json
language sql
security definer
set search_path = public
as $$
  select coalesce(json_object_agg(key, value), '{}'::json) from settings;
$$;

-- Upsert a single setting
create or replace function update_setting(p_key text, p_value text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

-- Bulk-complete all non-terminal active lines at end of work day
create or replace function complete_all_lines_for_day(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terminal_status_id uuid;
  v_line record;
  v_updated_count integer := 0;
begin
  -- Find the terminal (Завершено) status
  select id into v_terminal_status_id
    from task_statuses
   where is_terminal = true
   order by order_index desc
   limit 1;

  if v_terminal_status_id is null then
    return 0;
  end if;

  -- Complete each non-terminal active line
  for v_line in
    select id, status_id, name, updated_at
      from lines
     where is_active = true
       and (status_id is null or status_id != v_terminal_status_id)
  loop
    perform change_line_status(v_line.id, v_terminal_status_id, p_user_id, null);
    v_updated_count := v_updated_count + 1;
  end loop;

  return v_updated_count;
end;
$$;

grant execute on function get_settings() to anon, authenticated;
grant execute on function update_setting(text, text) to anon, authenticated;
grant execute on function complete_all_lines_for_day(uuid) to anon, authenticated;
