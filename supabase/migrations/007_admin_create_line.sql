-- ============================================================
-- ADMIN CREATE LINE RPC
-- ============================================================

create or replace function admin_create_line(
  p_subdivision_id uuid,
  p_name text
)
returns lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line lines;
  v_order_index int;
  v_start_status_id uuid;
begin
  select coalesce(max(order_index), -1) + 1
    into v_order_index
    from lines
   where subdivision_id = p_subdivision_id;

  select id
    into v_start_status_id
    from task_statuses
   order by order_index asc
   limit 1;

  insert into lines (subdivision_id, name, order_index, status_id, is_active)
  values (p_subdivision_id, trim(p_name), v_order_index, v_start_status_id, true)
  returning * into v_line;

  return v_line;
end;
$$;

grant execute on function admin_create_line(uuid, text) to anon, authenticated;
