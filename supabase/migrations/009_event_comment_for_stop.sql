alter table if exists events
  add column if not exists comment text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_comment_len_check'
  ) then
    alter table events
      add constraint events_comment_len_check
      check (comment is null or char_length(comment) <= 25);
  end if;
end $$;

drop function if exists change_line_status(uuid, uuid, uuid);

create or replace function change_line_status(
  p_line_id uuid,
  p_new_status_id uuid,
  p_user_id uuid,
  p_comment text default null
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
  v_comment text;
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

  v_comment := nullif(left(btrim(coalesce(p_comment, '')), 25), '');

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

  insert into events (line_id, user_id, description, comment)
  values (p_line_id, p_user_id, v_event_description, v_comment);

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

grant execute on function change_line_status(uuid, uuid, uuid, text) to anon, authenticated;

create or replace function get_events(p_limit int default 50)
returns json
language sql security definer
as $$
  select json_agg(
    json_build_object(
      'id',          e.id,
      'description', e.description,
      'comment',     e.comment,
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
