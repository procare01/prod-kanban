-- ============================================================
-- USERS: display_id + safe delete behavior
-- ============================================================

create sequence if not exists users_display_id_seq;

alter table if exists users
  add column if not exists display_id bigint;

alter table if exists users
  alter column display_id set default nextval('users_display_id_seq');

with next_values as (
  select
    id,
    coalesce((select max(display_id) from users), 0) +
    row_number() over (order by created_at, id) as next_display_id
  from users
  where display_id is null
)
update users u
set display_id = n.next_display_id
from next_values n
where u.id = n.id;

select setval(
  'users_display_id_seq',
  coalesce((select max(display_id) from users), 1),
  true
);

alter table if exists users
  alter column display_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_display_id_key'
  ) then
    alter table users add constraint users_display_id_key unique (display_id);
  end if;
end $$;

alter table if exists lines
  drop constraint if exists lines_updated_by_fkey;

alter table if exists lines
  add constraint lines_updated_by_fkey
  foreign key (updated_by) references users(id) on delete set null;

alter table if exists line_history
  drop constraint if exists line_history_user_id_fkey;

alter table if exists line_history
  add constraint line_history_user_id_fkey
  foreign key (user_id) references users(id) on delete set null;

alter table if exists events
  drop constraint if exists events_user_id_fkey;

alter table if exists events
  add constraint events_user_id_fkey
  foreign key (user_id) references users(id) on delete set null;
