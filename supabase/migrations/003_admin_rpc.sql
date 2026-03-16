-- ============================================================
-- ADMIN RPC FUNCTIONS
-- ============================================================

create or replace function admin_create_user(
  p_name text,
  p_role text,
  p_pin text
)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users;
begin
  insert into users (name, role, pin)
  values (trim(p_name), p_role, p_pin)
  returning * into v_user;

  return v_user;
end;
$$;

create or replace function admin_update_user_pin(
  p_id uuid,
  p_pin text
)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users;
begin
  update users
  set pin = p_pin
  where id = p_id
  returning * into v_user;

  return v_user;
end;
$$;

create or replace function admin_delete_user(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$ delete from users where id = p_id; $$;

create or replace function admin_create_status(
  p_name text,
  p_color text,
  p_order_index int,
  p_is_terminal boolean
)
returns task_statuses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status task_statuses;
begin
  insert into task_statuses (name, color, order_index, is_terminal)
  values (trim(p_name), p_color, p_order_index, p_is_terminal)
  returning * into v_status;

  return v_status;
end;
$$;

create or replace function admin_delete_status(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$ delete from task_statuses where id = p_id; $$;

create or replace function admin_set_line_active(
  p_id uuid,
  p_is_active boolean
)
returns lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line lines;
begin
  update lines
  set is_active = p_is_active
  where id = p_id
  returning * into v_line;

  return v_line;
end;
$$;

grant execute on function admin_create_user(text, text, text) to anon, authenticated;
grant execute on function admin_update_user_pin(uuid, text) to anon, authenticated;
grant execute on function admin_delete_user(uuid) to anon, authenticated;
grant execute on function admin_create_status(text, text, int, boolean) to anon, authenticated;
grant execute on function admin_delete_status(uuid) to anon, authenticated;
grant execute on function admin_set_line_active(uuid, boolean) to anon, authenticated;
