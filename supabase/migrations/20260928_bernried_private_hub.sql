-- Bernried private Project Hub · 2026-09-28
-- Applied to Supabase production as migration: bernried_private_hub_stands_timeline_roles

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  audience text not null check (audience in ('tba','bauherren','fachplaner')),
  display_name text not null check (char_length(display_name) between 1 and 160),
  created_at timestamptz not null default now(),
  primary key (project_id,user_id),
  unique(project_id,audience)
);

alter table public.project_members enable row level security;
revoke all on public.project_members from anon;
revoke all on public.project_members from authenticated;
grant select on public.project_members to authenticated;

drop policy if exists "members read own project membership" on public.project_members;
create policy "members read own project membership"
on public.project_members for select to authenticated
using (user_id = auth.uid());

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.project_members m
  where m.project_id = p_project_id and m.user_id = auth.uid()
); $$;

create or replace function public.is_project_editor(p_project_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.project_members m
  where m.project_id = p_project_id and m.user_id = auth.uid() and m.role = 'editor'
); $$;

create or replace function public.is_project_member_slug(p_slug text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.projects p
  join public.project_members m on m.project_id = p.id
  where p.slug = p_slug and m.user_id = auth.uid()
); $$;

create or replace function public.is_project_editor_slug(p_slug text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.projects p
  join public.project_members m on m.project_id = p.id
  where p.slug = p_slug and m.user_id = auth.uid() and m.role = 'editor'
); $$;

revoke all on function public.is_project_member(uuid), public.is_project_editor(uuid),
  public.is_project_member_slug(text), public.is_project_editor_slug(text) from public;
grant execute on function public.is_project_member(uuid), public.is_project_editor(uuid),
  public.is_project_member_slug(text), public.is_project_editor_slug(text) to authenticated;

create table if not exists public.document_stands (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null check (category in ('grundrisse','schnitte_ansichten')),
  label text not null check (char_length(label) between 1 and 160),
  stand_date date,
  note text not null default '' check (char_length(note) <= 2000),
  sort_order integer not null default 0,
  is_current boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents
  add column if not exists stand_id uuid references public.document_stands(id) on delete restrict,
  add column if not exists meta text not null default '' check (char_length(meta) <= 2000);

create index if not exists document_stands_project_category_idx
  on public.document_stands(project_id,category,sort_order,stand_date desc);
create index if not exists documents_stand_order_idx
  on public.documents(project_id,stand_id,sort_order,title);

alter table public.document_stands enable row level security;
revoke all on public.document_stands from anon;
revoke all on public.document_stands from authenticated;
grant select,insert,update,delete on public.document_stands to authenticated;

drop policy if exists "members read document stands" on public.document_stands;
create policy "members read document stands" on public.document_stands
for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "editors manage document stands" on public.document_stands;
create policy "editors manage document stands" on public.document_stands
for all to authenticated
using (public.is_project_editor(project_id))
with check (public.is_project_editor(project_id));

create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_date date not null,
  category text not null default 'other'
    check (category in ('planstand','versand','besprechung','eingang','entscheidung','other')),
  title text not null check (char_length(title) between 1 and 240),
  description text not null default '' check (char_length(description) <= 12000),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.timeline_event_documents (
  event_id uuid not null references public.timeline_events(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  sort_order integer not null default 0,
  primary key(event_id,document_id)
);

create table if not exists public.timeline_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_id uuid not null references public.timeline_events(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  filename text not null check (char_length(filename) between 1 and 500),
  storage_path text not null unique,
  mime_type text not null default '',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  sort_order integer not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists timeline_events_project_date_idx
  on public.timeline_events(project_id,event_date desc,sort_order,id);
create index if not exists timeline_files_event_idx
  on public.timeline_files(event_id,sort_order,created_at);

alter table public.timeline_events enable row level security;
alter table public.timeline_event_documents enable row level security;
alter table public.timeline_files enable row level security;
revoke all on public.timeline_events, public.timeline_event_documents, public.timeline_files from anon;
revoke all on public.timeline_events, public.timeline_event_documents, public.timeline_files from authenticated;
grant select,insert,update,delete on public.timeline_events, public.timeline_event_documents, public.timeline_files to authenticated;

drop policy if exists "members read timeline events" on public.timeline_events;
create policy "members read timeline events" on public.timeline_events
for select to authenticated using (public.is_project_member(project_id));
drop policy if exists "editors manage timeline events" on public.timeline_events;
create policy "editors manage timeline events" on public.timeline_events
for all to authenticated using (public.is_project_editor(project_id))
with check (public.is_project_editor(project_id));

drop policy if exists "members read timeline document links" on public.timeline_event_documents;
create policy "members read timeline document links" on public.timeline_event_documents
for select to authenticated using (
  exists(select 1 from public.timeline_events e
         where e.id=event_id and public.is_project_member(e.project_id))
);
drop policy if exists "editors manage timeline document links" on public.timeline_event_documents;
create policy "editors manage timeline document links" on public.timeline_event_documents
for all to authenticated using (
  exists(select 1 from public.timeline_events e
         where e.id=event_id and public.is_project_editor(e.project_id))
) with check (
  exists(select 1 from public.timeline_events e
         where e.id=event_id and public.is_project_editor(e.project_id))
);

drop policy if exists "members read timeline files" on public.timeline_files;
create policy "members read timeline files" on public.timeline_files
for select to authenticated using (public.is_project_member(project_id));
drop policy if exists "editors manage timeline files" on public.timeline_files;
create policy "editors manage timeline files" on public.timeline_files
for all to authenticated using (public.is_project_editor(project_id))
with check (public.is_project_editor(project_id));

drop policy if exists "public can read projects" on public.projects;
drop policy if exists "public can read published documents" on public.documents;
drop policy if exists "public can read published images" on public.images;
drop policy if exists "project admins can manage projects" on public.projects;
drop policy if exists "project admins can manage documents" on public.documents;
drop policy if exists "project admins can manage images" on public.images;

create policy "members read projects" on public.projects
for select to authenticated using (public.is_project_member(id));
create policy "editors update projects" on public.projects
for update to authenticated using (public.is_project_editor(id))
with check (public.is_project_editor(id));

create policy "members read documents" on public.documents
for select to authenticated using (public.is_project_member(project_id));
create policy "editors manage documents" on public.documents
for all to authenticated using (public.is_project_editor(project_id))
with check (public.is_project_editor(project_id));

create policy "members read images" on public.images
for select to authenticated using (public.is_project_member(project_id));
create policy "editors manage images" on public.images
for all to authenticated using (public.is_project_editor(project_id))
with check (public.is_project_editor(project_id));

update storage.buckets set public=false where id='project-hub';

drop policy if exists "public read project hub files" on storage.objects;
drop policy if exists "project admins upload project hub files" on storage.objects;
drop policy if exists "project admins update project hub files" on storage.objects;
drop policy if exists "project admins delete project hub files" on storage.objects;

create policy "project members read hub files" on storage.objects
for select to authenticated using (
  bucket_id='project-hub' and public.is_project_member_slug((storage.foldername(name))[1])
);
create policy "project editors upload hub files" on storage.objects
for insert to authenticated with check (
  bucket_id='project-hub' and public.is_project_editor_slug((storage.foldername(name))[1])
);
create policy "project editors update hub files" on storage.objects
for update to authenticated using (
  bucket_id='project-hub' and public.is_project_editor_slug((storage.foldername(name))[1])
) with check (
  bucket_id='project-hub' and public.is_project_editor_slug((storage.foldername(name))[1])
);
create policy "project editors delete hub files" on storage.objects
for delete to authenticated using (
  bucket_id='project-hub' and public.is_project_editor_slug((storage.foldername(name))[1])
);

-- Bootstrap the existing legacy admin only long enough to provision shared accounts.
insert into public.project_members(project_id,user_id,role,audience,display_name)
select pa.project_id,pa.user_id,'editor','tba','Titus Bernhard Architekten'
from public.project_admins pa
join public.projects p on p.id=pa.project_id
where p.slug='bernried'
on conflict (project_id,user_id) do update
set role='editor',audience='tba',display_name='Titus Bernhard Architekten';
