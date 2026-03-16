-- ============================================================
-- PRODUCTION KANBAN — Supabase Migration 001
-- ============================================================

-- EXTENSIONS
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null check (role in ('brigadir','controller','admin')),
  pin         text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists task_statuses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#6B7280',
  order_index int  not null default 0,
  is_terminal boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists subdivisions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  order_index int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists lines (
  id            uuid primary key default gen_random_uuid(),
  subdivision_id uuid not null references subdivisions(id) on delete cascade,
  name          text not null,
  order_index   int  not null default 0,
  status_id     uuid references task_statuses(id),
  updated_by    uuid references users(id),
  updated_at    timestamptz not null default now(),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists line_history (
  id            uuid primary key default gen_random_uuid(),
  line_id       uuid not null references lines(id) on delete cascade,
  user_id       uuid references users(id),
  old_status_id uuid references task_statuses(id),
  new_status_id uuid references task_statuses(id),
  created_at    timestamptz not null default now()
);

create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid references lines(id) on delete set null,
  user_id     uuid references users(id),
  description text not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_lines_subdivision on lines(subdivision_id);
create index if not exists idx_line_history_line on line_history(line_id);
create index if not exists idx_events_created on events(created_at desc);

-- ============================================================
-- SEED: task_statuses
-- ============================================================
insert into task_statuses (id, name, color, order_index, is_terminal) values
  ('11111111-0000-0000-0000-000000000001', 'Початок',    '#6B7280', 0, false),
  ('11111111-0000-0000-0000-000000000002', 'Фасування',  '#F59E0B', 1, false),
  ('11111111-0000-0000-0000-000000000003', 'Зупинка',    '#EF4444', 2, false),
  ('11111111-0000-0000-0000-000000000004', 'Завершено',  '#10B981', 3, true)
on conflict (id) do nothing;

-- ============================================================
-- SEED: subdivisions
-- ============================================================
insert into subdivisions (id, name, order_index) values
  ('22222222-0000-0000-0000-000000000001', 'Лінія',    0),
  ('22222222-0000-0000-0000-000000000002', 'Тубна',    1),
  ('22222222-0000-0000-0000-000000000003', 'Сашетна',  2)
on conflict (id) do nothing;

-- ============================================================
-- SEED: lines
-- ============================================================
insert into lines (subdivision_id, name, order_index, status_id) values
  -- Лінія 1–6
  ('22222222-0000-0000-0000-000000000001', 'Лінія-1', 0, '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000001', 'Лінія-2', 1, '11111111-0000-0000-0000-000000000002'),
  ('22222222-0000-0000-0000-000000000001', 'Лінія-3', 2, '11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000001', 'Лінія-4', 3, '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000001', 'Лінія-5', 4, '11111111-0000-0000-0000-000000000004'),
  ('22222222-0000-0000-0000-000000000001', 'Лінія-6', 5, '11111111-0000-0000-0000-000000000001'),
  -- Тубна 1–4
  ('22222222-0000-0000-0000-000000000002', 'Тубна-1', 0, '11111111-0000-0000-0000-000000000002'),
  ('22222222-0000-0000-0000-000000000002', 'Тубна-2', 1, '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002', 'Тубна-3', 2, '11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000002', 'Тубна-4', 3, '11111111-0000-0000-0000-000000000001'),
  -- Сашетна 1–5
  ('22222222-0000-0000-0000-000000000003', 'Сашетна-1', 0, '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000003', 'Сашетна-2', 1, '11111111-0000-0000-0000-000000000002'),
  ('22222222-0000-0000-0000-000000000003', 'Сашетна-3', 2, '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000003', 'Сашетна-4', 3, '11111111-0000-0000-0000-000000000004'),
  ('22222222-0000-0000-0000-000000000003', 'Сашетна-5', 4, '11111111-0000-0000-0000-000000000001');

-- ============================================================
-- SEED: users (demo)
-- ============================================================
insert into users (name, role, pin) values
  ('Іван Адміністратор', 'admin',      '0000'),
  ('Олег Бригадир',      'brigadir',   '1111'),
  ('Марія Бригадир',     'brigadir',   '2222'),
  ('Петро Контролер',    'controller', '3333')
on conflict (pin) do nothing;
