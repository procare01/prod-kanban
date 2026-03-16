-- ============================================================
-- DAILY RESET OF LINE STATUSES
-- ============================================================

create or replace function reset_lines_for_new_day()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_status_id uuid;
  v_updated_count integer;
begin
  select id
    into v_first_status_id
    from task_statuses
   order by order_index asc
   limit 1;

  update lines
     set status_id = v_first_status_id,
         updated_by = null,
         updated_at = now()
   where is_active = true
     and updated_at::date < current_date
     and (
       status_id is distinct from v_first_status_id
       or updated_by is not null
     );

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

grant execute on function reset_lines_for_new_day() to anon, authenticated;

create or replace function change_line_status(
  p_line_id uuid,
  p_new_status_id uuid,
  p_user_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status_id uuid;
  v_old_status_name text;
  v_new_status_name text;
  v_line_name text;
  v_user_name text;
  v_previous_updated_at timestamptz;
  v_previous_updated_by uuid;
  v_first_status_id uuid;
  v_seconds_since_previous_change int;
  v_result json;
  v_event_description text;
  v_diff_text text;
begin
  select id
    into v_first_status_id
    from task_statuses
   order by order_index asc
   limit 1;

  select l.status_id, l.name, l.updated_at, l.updated_by
    into v_old_status_id, v_line_name, v_previous_updated_at, v_previous_updated_by
    from lines l
   where l.id = p_line_id;

  if v_previous_updated_at::date < current_date then
    v_old_status_id := v_first_status_id;
    v_previous_updated_by := null;
  end if;

  select name into v_old_status_name
    from task_statuses
   where id = v_old_status_id;

  select name into v_new_status_name
    from task_statuses
   where id = p_new_status_id;

  -- Ignore no-op transitions so "Початок -> Початок" is never written to history/events.
  if v_old_status_id = p_new_status_id then
    select json_build_object(
      'id', l.id,
      'name', l.name,
      'updated_at', l.updated_at,
      'updated_by_name', (
        select u.name
          from users u
         where u.id = l.updated_by
      ),
      'status', json_build_object(
        'id', st.id,
        'name', st.name,
        'color', st.color,
        'is_terminal', st.is_terminal,
        'order_index', st.order_index
      )
    )
      into v_result
      from lines l
      left join task_statuses st on st.id = l.status_id
     where l.id = p_line_id;

    return v_result;
  end if;

  select name into v_user_name
    from users
   where id = p_user_id;

  v_seconds_since_previous_change :=
    case
      when v_previous_updated_at is null then null
      when v_previous_updated_at::date < current_date then null
      when v_previous_updated_by is null and v_old_status_id = v_first_status_id then null
      else greatest(extract(epoch from now() - v_previous_updated_at)::int, 0)
    end;

  update lines
     set status_id = p_new_status_id,
         updated_by = p_user_id,
         updated_at = now()
   where id = p_line_id;

  insert into line_history (
    line_id,
    user_id,
    old_status_id,
    new_status_id,
    seconds_since_previous_change
  )
  values (
    p_line_id,
    p_user_id,
    v_old_status_id,
    p_new_status_id,
    v_seconds_since_previous_change
  );

  v_event_description :=
    v_user_name || ' змінив ' || v_line_name || ': ' ||
    coalesce(v_old_status_name, '—') || ' → ' || v_new_status_name;

  if v_seconds_since_previous_change is not null then
    v_diff_text :=
      case
        when v_seconds_since_previous_change < 60 then v_seconds_since_previous_change::text || ' сек'
        when v_seconds_since_previous_change < 3600 then floor(v_seconds_since_previous_change / 60.0)::int::text || ' хв'
        when v_seconds_since_previous_change < 86400 then
          floor(v_seconds_since_previous_change / 3600.0)::int::text ||
          ' год' ||
          case
            when floor(mod(v_seconds_since_previous_change, 3600) / 60.0)::int > 0
              then ' ' || floor(mod(v_seconds_since_previous_change, 3600) / 60.0)::int::text || ' хв'
            else ''
          end
        else
          floor(v_seconds_since_previous_change / 86400.0)::int::text ||
          ' дн' ||
          case
            when floor(mod(v_seconds_since_previous_change, 86400) / 3600.0)::int > 0
              then ' ' || floor(mod(v_seconds_since_previous_change, 86400) / 3600.0)::int::text || ' год'
            else ''
          end
      end;

    v_event_description := v_event_description || ' (через ' || v_diff_text || ')';
  end if;

  insert into events (line_id, user_id, description)
  values (p_line_id, p_user_id, v_event_description);

  select json_build_object(
    'id', l.id,
    'name', l.name,
    'updated_at', l.updated_at,
    'updated_by_name', v_user_name,
    'status', json_build_object(
      'id', st.id,
      'name', st.name,
      'color', st.color,
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
