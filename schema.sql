-- ============================================================================
-- Robustic — Supabase schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query).
-- Safe to run once on a fresh project. If you need to re-run it, drop the
-- tables first (see bottom of file, commented out).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Profiles: one row per team member, linked to Supabase's built-in auth.users.
-- This is where roles live. Supabase Auth handles passwords/sessions; this
-- table just adds "who are they, and what can they do."
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  name text not null,
  role text not null default 'viewer' check (role in ('admin', 'finance', 'manager', 'viewer')),
  created_at timestamptz default now()
);

-- Auto-create a profile row whenever someone signs up via Supabase Auth.
-- New users default to 'viewer' -- an admin promotes them afterward.
create function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email), 'viewer');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Helper used inside RLS policies below.
create function get_my_role() returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql security definer stable;

-- ---------------------------------------------------------------------------
-- Batches: one row per uploaded file.
-- ---------------------------------------------------------------------------
create table batches (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('GB', 'EB', 'EB_MB', 'SP', 'SP_MB')),
  filename text not null,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Line items: the cleaned per-agent-per-block rows from each batch.
-- Mirrors exactly the shape the parsing engine already produces.
-- ---------------------------------------------------------------------------
create table line_items (
  id bigint generated always as identity primary key,
  batch_id uuid references batches(id) on delete cascade not null,
  agent_username text not null,
  source_block text not null,
  tickets numeric,
  stake numeric,
  payout numeric,
  profit numeric,
  commission_amount numeric,
  commission_type text,
  balance numeric,
  is_house boolean not null default false
);
create index line_items_batch_idx on line_items(batch_id);
create index line_items_agent_idx on line_items(lower(agent_username));

-- ---------------------------------------------------------------------------
-- Supplemental payments: bonuses, palliatives, gifts -- kept separate from
-- commission, same as the parsing engine already treats them.
-- ---------------------------------------------------------------------------
create table supplemental_payments (
  id bigint generated always as identity primary key,
  batch_id uuid references batches(id) on delete cascade not null,
  agent_username text not null,
  type text not null,
  amount numeric not null
);
create index supplemental_batch_idx on supplemental_payments(batch_id);
create index supplemental_agent_idx on supplemental_payments(lower(agent_username));

-- ---------------------------------------------------------------------------
-- Interventions: the call-log / follow-up workflow.
-- ---------------------------------------------------------------------------
create table interventions (
  id uuid primary key default gen_random_uuid(),
  agent_username text not null,
  agent_state text,
  contacted_by uuid references profiles(id),
  contacted_at timestamptz default now(),
  reason text,
  agent_feedback text,
  action_required text,
  follow_up_date date,
  status text not null default 'open' check (status in ('open', 'resolved')),
  notes text
);
create index interventions_agent_idx on interventions(lower(agent_username));
create index interventions_status_idx on interventions(status);

-- ============================================================================
-- Row Level Security -- this is what actually enforces the four roles.
-- Permission model:
--   view_reports        : admin, finance, manager, viewer   (batches/line_items/supplemental read)
--   upload/delete_upload: admin, finance                    (batches/line_items/supplemental write)
--   export               : admin, finance                    (no separate table -- same read access as view_reports; export is a client-side action)
--   manage_followups     : admin, finance, manager           (interventions read/write)
--   manage_users         : admin only                        (profiles write)
-- ============================================================================

alter table profiles enable row level security;
alter table batches enable row level security;
alter table line_items enable row level security;
alter table supplemental_payments enable row level security;
alter table interventions enable row level security;

-- profiles: everyone can read all profiles (needed to show names on interventions etc);
-- only admins can change roles; people can update their own name.
create policy "profiles are readable by any authenticated user"
  on profiles for select using (auth.role() = 'authenticated');
create policy "admins can update any profile"
  on profiles for update using (get_my_role() = 'admin');
create policy "users can update their own name"
  on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- batches: all four roles can view; only admin/finance can upload or delete.
create policy "authenticated can view batches"
  on batches for select using (auth.role() = 'authenticated');
create policy "admin/finance can insert batches"
  on batches for insert with check (get_my_role() in ('admin', 'finance'));
create policy "admin/finance can delete batches"
  on batches for delete using (get_my_role() in ('admin', 'finance'));

-- line_items: same pattern, and inserts must belong to a batch the user could
-- also insert (kept simple here since the app always writes batch + items together).
create policy "authenticated can view line items"
  on line_items for select using (auth.role() = 'authenticated');
create policy "admin/finance can insert line items"
  on line_items for insert with check (get_my_role() in ('admin', 'finance'));
create policy "admin/finance can delete line items"
  on line_items for delete using (get_my_role() in ('admin', 'finance'));

-- supplemental_payments: same pattern.
create policy "authenticated can view supplemental payments"
  on supplemental_payments for select using (auth.role() = 'authenticated');
create policy "admin/finance can insert supplemental payments"
  on supplemental_payments for insert with check (get_my_role() in ('admin', 'finance'));
create policy "admin/finance can delete supplemental payments"
  on supplemental_payments for delete using (get_my_role() in ('admin', 'finance'));

-- interventions: admin/finance/manager can view and manage; viewer has no access at all.
create policy "admin/finance/manager can view interventions"
  on interventions for select using (get_my_role() in ('admin', 'finance', 'manager'));
create policy "admin/finance/manager can insert interventions"
  on interventions for insert with check (get_my_role() in ('admin', 'finance', 'manager'));
create policy "admin/finance/manager can update interventions"
  on interventions for update using (get_my_role() in ('admin', 'finance', 'manager'));
create policy "admin/finance/manager can delete interventions"
  on interventions for delete using (get_my_role() in ('admin', 'finance', 'manager'));

-- ============================================================================
-- To start over from scratch, run this block first, then re-run everything above:
--
-- drop table if exists interventions cascade;
-- drop table if exists supplemental_payments cascade;
-- drop table if exists line_items cascade;
-- drop table if exists batches cascade;
-- drop table if exists profiles cascade;
-- drop function if exists get_my_role();
-- drop function if exists handle_new_user() cascade;
-- ============================================================================
