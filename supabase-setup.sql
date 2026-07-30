-- =====================================================================
-- BHB Central Promotion & Tracking System — Supabase Setup
-- =====================================================================
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE everywhere.
--
-- ARCHITECTURE NOTE:
-- This is a single shared database serving three business lines
-- (cleaning, events, remodeling) plus one admin dashboard — every
-- inquiry is tagged with which business + which employee referral
-- code it came from. Row Level Security is enabled on every table
-- with NO policies for the anon/public roles, so the anon key (used
-- nowhere in this app) has zero access. All reads/writes go through
-- the Express backend using the SERVICE ROLE key, which always
-- bypasses RLS. That's the entire access model — simple and safe.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. BUSINESSES  (the 3 service lines: cleaning / events / remodeling)
-- ---------------------------------------------------------------------
create table if not exists businesses (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,      -- 'cleaning' | 'events' | 'remodeling'
  bname       text not null,
  bookings    integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. EMPLOYEES  (affiliates — each has a unique referral code)
-- ---------------------------------------------------------------------
create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  fname          text not null,
  lname          text not null default '',
  referral_code  text unique not null,
  pull_ins       integer not null default 0,
  created_at     timestamptz not null default now()
);

create unique index if not exists employees_referral_code_lower_idx
  on employees (lower(referral_code));

-- ---------------------------------------------------------------------
-- 3. INQUIRIES  (every submitted form, from any of the 3 businesses)
-- ---------------------------------------------------------------------
create table if not exists inquiries (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references businesses(id) on delete set null,
  employee_id    uuid references employees(id) on delete set null,
  referral_code  text not null default 'Direct',
  fname          text not null,
  lname          text not null default '',
  email          text,
  phone          text,
  status         text not null default 'pending'
                   check (status in ('pending', 'booked', 'cancelled')),
  details        jsonb not null default '{}'::jsonb,  -- every service-specific answer
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists inquiries_business_id_idx  on inquiries (business_id);
create index if not exists inquiries_employee_id_idx  on inquiries (employee_id);
create index if not exists inquiries_status_idx        on inquiries (status);
create index if not exists inquiries_created_at_idx    on inquiries (created_at desc);

-- keep updated_at current on every change
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_inquiries_updated_at on inquiries;
create trigger trg_inquiries_updated_at
  before update on inquiries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 4. AUTO-INCREMENT BOOKINGS & PULL-INS WHEN STATUS → 'booked'
--    (and safely reverse it if an admin un-books a mistaken entry)
-- ---------------------------------------------------------------------
create or replace function handle_inquiry_status_change() returns trigger as $$
begin
  if (tg_op = 'UPDATE' and old.status is distinct from new.status) then

    if new.status = 'booked' and old.status <> 'booked' then
      if new.business_id is not null then
        update businesses set bookings = bookings + 1 where id = new.business_id;
      end if;
      if new.employee_id is not null then
        update employees set pull_ins = pull_ins + 1 where id = new.employee_id;
      end if;

    elsif old.status = 'booked' and new.status <> 'booked' then
      if new.business_id is not null then
        update businesses set bookings = greatest(bookings - 1, 0) where id = new.business_id;
      end if;
      if new.employee_id is not null then
        update employees set pull_ins = greatest(pull_ins - 1, 0) where id = new.employee_id;
      end if;
    end if;

  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_inquiry_status_change on inquiries;
create trigger trg_inquiry_status_change
  after update on inquiries
  for each row execute function handle_inquiry_status_change();

-- ---------------------------------------------------------------------
-- 5. FORM CONFIG  (kept for the existing "Form Builder" admin tab)
-- ---------------------------------------------------------------------
create table if not exists form_configs (
  id                    uuid primary key default gen_random_uuid(),
  form_title            text,
  form_subtitle         text,
  primary_color         text,
  field_fname_label     text,
  field_lname_label     text,
  field_lname_required  boolean default false,
  custom_fields         jsonb default '[]'::jsonb,
  updated_at            timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 6. ADMIN USERS  (real login for the dashboard)
-- ---------------------------------------------------------------------
create table if not exists admin_users (
  id             uuid primary key default gen_random_uuid(),
  email          text unique not null,
  password_hash  text not null,
  name           text,
  created_at     timestamptz not null default now()
);

create unique index if not exists admin_users_email_lower_idx
  on admin_users (lower(email));

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY — lock every table down.
--    No policies are created for anon/authenticated, so those roles
--    get NO access at all. Only the service_role key (used by the
--    backend) can read or write. This is intentional and final.
-- ---------------------------------------------------------------------
alter table businesses    enable row level security;
alter table employees     enable row level security;
alter table inquiries     enable row level security;
alter table form_configs  enable row level security;
alter table admin_users   enable row level security;

-- ---------------------------------------------------------------------
-- 8. SEED THE 3 BUSINESSES  (safe to re-run — updates slug/name only)
-- ---------------------------------------------------------------------
insert into businesses (slug, bname, bookings)
values
  ('cleaning',    'Cleaning Services',    0),
  ('events',      'Events & Rental',      0),
  ('remodeling',  'Remodeling Services',  0)
on conflict (slug) do update set bname = excluded.bname;

-- ---------------------------------------------------------------------
-- 9. CREATE YOUR FIRST ADMIN LOGIN
-- ---------------------------------------------------------------------
-- Do NOT hand-write a password hash here. Run this in the project folder:
--
--     node scripts/create-admin.js "you@bhb.com" "your-password" "Your Name"
--
-- It will print a ready-to-paste INSERT statement with a proper bcrypt
-- hash. Run that statement here in the SQL editor. Repeat for each
-- additional admin account you want.
-- =====================================================================
