-- ============================================================
-- TODAY'S LINE HISTORY — for analytics "Process per card" chart
-- Returns all history entries for today grouped by line
-- ============================================================

create or replace function get_today_line_history()
returns json
language sql
security definer
set search_path = public
as $$
  select json_agg(
    json_build_object(
      'line_id',                        lh.line_id,
      'line_name',                      l.name,
      'old_status_name',                os.name,
      'old_status_color',               os.color,
      'old_status_is_terminal',         coalesce(os.is_terminal, false),
      'new_status_name',                ns.name,
      'new_status_color',               ns.color,
      'new_status_is_terminal',         coalesce(ns.is_terminal, false),
      'created_at',                     lh.created_at,
      'seconds_since_previous_change',  lh.seconds_since_previous_change
    )
    order by lh.created_at asc
  )
  from line_history lh
  join lines l on l.id = lh.line_id
  left join task_statuses os on os.id = lh.old_status_id
  left join task_statuses ns on ns.id = lh.new_status_id
  where lh.created_at::date = current_date
    and l.is_active = true;
$$;

grant execute on function get_today_line_history() to anon, authenticated;

-- ============================================================
-- EVENTS WITH WEBHOOK STATUS — for admin "Recent Events" tab
-- Adds webhook_status, webhook_error columns to events table
-- ============================================================

alter table events
  add column if not exists webhook_status  text    default null,
  add column if not exists webhook_error   text    default null,
  add column if not exists webhook_sent_at timestamptz default null;

-- Update a single event's webhook status
create or replace function update_event_webhook_status(
  p_id      uuid,
  p_status  text,
  p_error   text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update events
     set webhook_status  = p_status,
         webhook_error   = p_error,
         webhook_sent_at = case when p_status = 'sent' then now() else webhook_sent_at end
   where id = p_id;
$$;

-- Get events with webhook info (for admin tab)
create or replace function get_events_admin(p_limit int default 100)
returns json
language sql
security definer
set search_path = public
as $$
  select json_agg(
    json_build_object(
      'id',             e.id,
      'description',    e.description,
      'comment',        e.comment,
      'created_at',     e.created_at,
      'line_name',      l.name,
      'user_name',      u.name,
      'webhook_status', e.webhook_status,
      'webhook_error',  e.webhook_error,
      'webhook_sent_at',e.webhook_sent_at
    )
    order by e.created_at desc
  )
  from (select * from events order by created_at desc limit p_limit) e
  left join lines l on l.id = e.line_id
  left join users u on u.id = e.user_id;
$$;

grant execute on function update_event_webhook_status(uuid, text, text) to anon, authenticated;
grant execute on function get_events_admin(int) to anon, authenticated;
