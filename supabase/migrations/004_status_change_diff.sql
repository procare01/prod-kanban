-- ============================================================
-- STATUS CHANGE DIFF LOGGING
-- ============================================================

alter table if exists line_history
  add column if not exists seconds_since_previous_change int;

create or replace function change_line_status(
  p_line_id      uuid,
  p_new_status_id uuid,
  p_user_id      uuid
)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_old_status_id   uuid;
  v_old_status_name text;
  v_new_status_name text;
  v_line_name       text;
  v_user_name       text;
  v_previous_updated_at timestamptz;
  v_seconds_since_previous_change int;
  v_result          json;
  v_event_description text;
  v_diff_text text;
begin
  select l.status_id, l.name, l.updated_at
    into v_old_status_id, v_line_name, v_previous_updated_at
    from lines l where l.id = p_line_id;

  select name into v_old_status_name
    from task_statuses where id = v_old_status_id;

  select name into v_new_status_name
    from task_statuses where id = p_new_status_id;

  select name into v_user_name
    from users where id = p_user_id;

  v_seconds_since_previous_change :=
    case
      when v_previous_updated_at is null then null
      else greatest(extract(epoch from now() - v_previous_updated_at)::int, 0)
    end;

  update lines
    set status_id  = p_new_status_id,
        updated_by = p_user_id,
        updated_at = now()
    where id = p_line_id;

  insert into line_history (line_id, user_id, old_status_id, new_status_id, seconds_since_previous_change)
    values (p_line_id, p_user_id, v_old_status_id, p_new_status_id, v_seconds_since_previous_change);

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
    values (
      p_line_id,
      p_user_id,
      v_event_description
    );

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

create or replace function get_line_history(p_line_id uuid)
returns json
language sql security definer
set search_path = public
as $$
  select json_agg(
    json_build_object(
      'id',              h.id,
      'created_at',      h.created_at,
      'user_name',       u.name,
      'old_status_name', os.name,
      'old_status_color',os.color,
      'new_status_name', ns.name,
      'new_status_color',ns.color,
      'seconds_since_previous_change', h.seconds_since_previous_change
    )
    order by h.created_at desc
  )
  from line_history h
  left join users u on u.id = h.user_id
  left join task_statuses os on os.id = h.old_status_id
  left join task_statuses ns on ns.id = h.new_status_id
  where h.line_id = p_line_id;
$$;
