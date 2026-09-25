-- MINDS//WORK Pilot 0.5 delta
-- Applied to Bernried Project Hub on 2026-09-25.
-- Keeps Planner-like task details private behind the existing project-admin RLS boundary.

alter table public.minds_entries drop constraint if exists minds_entries_state_check;
alter table public.minds_entries drop constraint if exists minds_entries_priority_check;

update public.minds_entries set priority='medium' where priority='normal';

alter table public.minds_entries
  add constraint minds_entries_state_check
  check (state in ('open','progress','waiting','done'));

alter table public.minds_entries
  add constraint minds_entries_priority_check
  check (priority in ('low','medium','important','urgent'));

alter table public.minds_entries
  alter column priority set default 'medium',
  add column if not exists start_date date,
  add column if not exists recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekdays','weekly','monthly','yearly')),
  add column if not exists labels jsonb not null default '[]'::jsonb
    check (jsonb_typeof(labels)='array'),
  add column if not exists show_on_card boolean not null default false;

create table if not exists public.minds_task_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entry_id uuid not null references public.minds_entries(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  content text not null check (char_length(content) between 1 and 12000),
  created_at timestamptz not null default now()
);

create table if not exists public.minds_task_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entry_id uuid not null references public.minds_entries(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  storage_path text not null default '',
  filename text not null check (char_length(filename) between 1 and 500),
  mime_type text not null default '',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  external_url text not null default '',
  created_at timestamptz not null default now(),
  check ((storage_path <> '') <> (external_url <> ''))
);

alter table public.minds_task_comments enable row level security;
alter table public.minds_task_files enable row level security;

revoke all on public.minds_task_comments, public.minds_task_files from anon;
revoke all on public.minds_task_comments, public.minds_task_files from authenticated;
grant select, insert, delete on public.minds_task_comments, public.minds_task_files to authenticated;

drop policy if exists "minds admins manage task comments" on public.minds_task_comments;
create policy "minds admins manage task comments" on public.minds_task_comments
for all to authenticated
using (
  exists(
    select 1 from public.project_admins pa
    where pa.project_id=minds_task_comments.project_id
      and pa.user_id=auth.uid()
  )
)
with check (
  exists(
    select 1 from public.project_admins pa
    where pa.project_id=minds_task_comments.project_id
      and pa.user_id=auth.uid()
  )
);

drop policy if exists "minds admins manage task files" on public.minds_task_files;
create policy "minds admins manage task files" on public.minds_task_files
for all to authenticated
using (
  exists(
    select 1 from public.project_admins pa
    where pa.project_id=minds_task_files.project_id
      and pa.user_id=auth.uid()
  )
)
with check (
  exists(
    select 1 from public.project_admins pa
    where pa.project_id=minds_task_files.project_id
      and pa.user_id=auth.uid()
  )
);

create index if not exists minds_task_comments_entry_idx
  on public.minds_task_comments(entry_id, created_at);

create index if not exists minds_task_files_entry_idx
  on public.minds_task_files(entry_id, created_at);
