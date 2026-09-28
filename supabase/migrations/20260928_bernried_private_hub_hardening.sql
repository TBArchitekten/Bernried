-- Security hardening applied after 20260928_bernried_private_hub.sql.
-- Moves SECURITY DEFINER RLS helpers out of the exposed public schema and reduces API grants.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists (
  select 1 from public.project_members m
  where m.project_id=p_project_id and m.user_id=auth.uid()
); $$;

create or replace function private.is_project_editor(p_project_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists (
  select 1 from public.project_members m
  where m.project_id=p_project_id and m.user_id=auth.uid() and m.role='editor'
); $$;

create or replace function private.is_project_member_slug(p_slug text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists (
  select 1 from public.projects p
  join public.project_members m on m.project_id=p.id
  where p.slug=p_slug and m.user_id=auth.uid()
); $$;

create or replace function private.is_project_editor_slug(p_slug text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists (
  select 1 from public.projects p
  join public.project_members m on m.project_id=p.id
  where p.slug=p_slug and m.user_id=auth.uid() and m.role='editor'
); $$;

revoke all on function private.is_project_member(uuid), private.is_project_editor(uuid),
  private.is_project_member_slug(text), private.is_project_editor_slug(text) from public, anon;
grant execute on function private.is_project_member(uuid), private.is_project_editor(uuid),
  private.is_project_member_slug(text), private.is_project_editor_slug(text) to authenticated;

drop policy if exists "members read document stands" on public.document_stands;
create policy "members read document stands" on public.document_stands
for select to authenticated using (private.is_project_member(project_id));
drop policy if exists "editors manage document stands" on public.document_stands;
create policy "editors manage document stands" on public.document_stands
for all to authenticated using (private.is_project_editor(project_id))
with check (private.is_project_editor(project_id));

drop policy if exists "members read timeline events" on public.timeline_events;
create policy "members read timeline events" on public.timeline_events
for select to authenticated using (private.is_project_member(project_id));
drop policy if exists "editors manage timeline events" on public.timeline_events;
create policy "editors manage timeline events" on public.timeline_events
for all to authenticated using (private.is_project_editor(project_id))
with check (private.is_project_editor(project_id));

drop policy if exists "members read timeline document links" on public.timeline_event_documents;
create policy "members read timeline document links" on public.timeline_event_documents
for select to authenticated using (
  exists(select 1 from public.timeline_events e where e.id=event_id and private.is_project_member(e.project_id))
);
drop policy if exists "editors manage timeline document links" on public.timeline_event_documents;
create policy "editors manage timeline document links" on public.timeline_event_documents
for all to authenticated using (
  exists(select 1 from public.timeline_events e where e.id=event_id and private.is_project_editor(e.project_id))
) with check (
  exists(select 1 from public.timeline_events e where e.id=event_id and private.is_project_editor(e.project_id))
);

drop policy if exists "members read timeline files" on public.timeline_files;
create policy "members read timeline files" on public.timeline_files
for select to authenticated using (private.is_project_member(project_id));
drop policy if exists "editors manage timeline files" on public.timeline_files;
create policy "editors manage timeline files" on public.timeline_files
for all to authenticated using (private.is_project_editor(project_id))
with check (private.is_project_editor(project_id));

drop policy if exists "members read projects" on public.projects;
create policy "members read projects" on public.projects
for select to authenticated using (private.is_project_member(id));
drop policy if exists "editors update projects" on public.projects;
create policy "editors update projects" on public.projects
for update to authenticated using (private.is_project_editor(id))
with check (private.is_project_editor(id));

drop policy if exists "members read documents" on public.documents;
create policy "members read documents" on public.documents
for select to authenticated using (private.is_project_member(project_id));
drop policy if exists "editors manage documents" on public.documents;
create policy "editors manage documents" on public.documents
for all to authenticated using (private.is_project_editor(project_id))
with check (private.is_project_editor(project_id));

drop policy if exists "members read images" on public.images;
create policy "members read images" on public.images
for select to authenticated using (private.is_project_member(project_id));
drop policy if exists "editors manage images" on public.images;
create policy "editors manage images" on public.images
for all to authenticated using (private.is_project_editor(project_id))
with check (private.is_project_editor(project_id));

drop policy if exists "project members read hub files" on storage.objects;
create policy "project members read hub files" on storage.objects
for select to authenticated using (
  bucket_id='project-hub' and private.is_project_member_slug((storage.foldername(name))[1])
);
drop policy if exists "project editors upload hub files" on storage.objects;
create policy "project editors upload hub files" on storage.objects
for insert to authenticated with check (
  bucket_id='project-hub' and private.is_project_editor_slug((storage.foldername(name))[1])
);
drop policy if exists "project editors update hub files" on storage.objects;
create policy "project editors update hub files" on storage.objects
for update to authenticated using (
  bucket_id='project-hub' and private.is_project_editor_slug((storage.foldername(name))[1])
) with check (
  bucket_id='project-hub' and private.is_project_editor_slug((storage.foldername(name))[1])
);
drop policy if exists "project editors delete hub files" on storage.objects;
create policy "project editors delete hub files" on storage.objects
for delete to authenticated using (
  bucket_id='project-hub' and private.is_project_editor_slug((storage.foldername(name))[1])
);

drop function if exists public.is_project_member(uuid);
drop function if exists public.is_project_editor(uuid);
drop function if exists public.is_project_member_slug(text);
drop function if exists public.is_project_editor_slug(text);

revoke all on public.projects,public.documents,public.images from anon;
revoke all on public.projects,public.documents,public.images from authenticated;
grant select,update on public.projects to authenticated;
grant select,insert,update,delete on public.documents,public.images to authenticated;
