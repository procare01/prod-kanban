-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- 1. Login by PIN → returns user row or null
create or replace function login_by_pin(p_pin text)
returns setof users
language sql security definer
as $$
  select * from users where pin = p_pin limit 1;
$$;

-- 2. Get full board data as JSON
create or replace function get_board()
returns json
language sql security definer
as $$
  select json_build_object(
    'subdivisions', (
      select json_agg(
        json_build_object(
          'id',          s.id,
          'name',        s.name,
          'order_index', s.order_index,
          'lines', (
            select json_agg(
              json_build_object(
                'id',           l.id,
                'name',         l.name,
                'order_index',  l.order_index,
                'is_active',    l.is_active,
                'updated_at',   l.updated_at,
                'status', (
                  select json_build_object(
                    'id',          st.id,
                    'name',        st.name,
                    'color',       st.color,
                    'is_terminal', st.is_terminal,
                    'order_index', st.order_index
                  ) from task_statuses st where st.id = l.status_id
                ),
                'updated_by_name', (
                  select u.name from users u where u.id = l.updated_by
                )
              )
              order by l.order_index
            )
            from lines l
            where l.subdivision_id = s.id and l.is_active = true
          )
        )
        order by s.order_index
      )
      from subdivisions s
    ),
    'statuses', (
      select json_agg(
        json_build_object(
          'id',          ts.id,
          'name',        ts.name,
          'color',       ts.color,
          'order_index', ts.order_index,
          'is_terminal', ts.is_terminal
        )
        order by ts.order_index
      )
      from task_statuses ts
    )
  );
$$;

-- 3. Change line status (main action)
create or replace function change_line_status(
  p_line_id      uuid,
  p_new_status_id uuid,
  p_user_id      uuid
)
returns json
language plpgsql security definer
as $$
declare
  v_old_status_id   uuid;
  v_old_status_name text;
  v_new_status_name text;
  v_line_name       text;
  v_user_name       text;
  v_result          json;
begin
  -- get current state
  select l.status_id, l.name
    into v_old_status_id, v_line_name
    from lines l where l.id = p_line_id;

  select name into v_old_status_name
    from task_statuses where id = v_old_status_id;

  select name into v_new_status_name
    from task_statuses where id = p_new_status_id;

  select name into v_user_name
    from users where id = p_user_id;

  -- update line
  update lines
    set status_id  = p_new_status_id,
        updated_by = p_user_id,
        updated_at = now()
    where id = p_line_id;

  -- write history
  insert into line_history (line_id, user_id, old_status_id, new_status_id)
    values (p_line_id, p_user_id, v_old_status_id, p_new_status_id);

  -- write event
  insert into events (line_id, user_id, description)
    values (
      p_line_id,
      p_user_id,
      v_user_name || ' змінив ' || v_line_name || ': ' ||
      coalesce(v_old_status_name, '—') || ' → ' || v_new_status_name
    );

  -- return updated line with status
  select json_build_object(
    'id',              l.id,
    'name',            l.name,
    'updated_at',      l.updated_at,
    'updated_by_name', v_user_name,
    'status', json_build_object(
      'id',          st.id,
      'name',        st.name,
      'color',       st.color,
      'is_terminal', st.is_terminal,
      'order_index', st.order_index
    )
  )
  into v_result
  from lines l
  join task_statuses st on st.id = l.status_id
  where l.id = p_line_id;

  return v_result;
end;
$$;

-- 4. Get line history
create or replace function get_line_history(p_line_id uuid)
returns json
language sql security definer
as $$
  select json_agg(
    json_build_object(
      'id',              h.id,
      'created_at',      h.created_at,
      'user_name',       u.name,
      'old_status_name', os.name,
      'old_status_color',os.color,
      'new_status_name', ns.name,
      'new_status_color',ns.color
    )
    order by h.created_at desc
  )
  from line_history h
  left join users u on u.id = h.user_id
  left join task_statuses os on os.id = h.old_status_id
  left join task_statuses ns on ns.id = h.new_status_id
  where h.line_id = p_line_id;
$$;

-- 5. Get recent events
create or replace function get_events(p_limit int default 50)
returns json
language sql security definer
as $$
  select json_agg(
    json_build_object(
      'id',          e.id,
      'description', e.description,
      'created_at',  e.created_at,
      'line_name',   l.name,
      'user_name',   u.name
    )
    order by e.created_at desc
  )
  from (select * from events order by created_at desc limit p_limit) e
  left join lines l on l.id = e.line_id
  left join users u on u.id = e.user_id;
$$;

-- 6. Admin: delete single history entry
create or replace function admin_delete_history_entry(p_id uuid)
returns void language sql security definer
as $$ delete from line_history where id = p_id; $$;

-- 7. Admin: clear all history for a line
create or replace function admin_clear_line_history(p_line_id uuid)
returns void language sql security definer
as $$ delete from line_history where line_id = p_line_id; $$;

-- 8. Admin: delete single event
create or replace function admin_delete_event(p_id uuid)
returns void language sql security definer
as $$ delete from events where id = p_id; $$;

-- 9. Admin: clear all events
create or replace function admin_clear_all_events()
returns void language sql security definer
as $$ delete from events; $$;

-- ============================================================
-- REALTIME
-- Enable realtime on key tables
-- ============================================================
alter publication supabase_realtime add table lines;
alter publication supabase_realtime add table events;
