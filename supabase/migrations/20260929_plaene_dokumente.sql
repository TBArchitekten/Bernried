-- Bernried Project Hub: unified plans, general documents, and VA01 stand.

alter table public.document_stands drop constraint if exists document_stands_category_check;
alter table public.documents drop constraint if exists documents_category_check;

alter table public.documents
  add column if not exists document_kind text not null default 'sonstiges',
  add column if not exists document_date date;

-- Merge the two legacy plan groups into one historical Pläne stand.
do $$
declare
  keep_id uuid;
  drop_id uuid;
begin
  select id into keep_id
  from public.document_stands
  where project_id='29c0726b-3e1e-4f48-81d3-b0f90d324d56'
    and category='grundrisse'
  order by created_at
  limit 1;

  select id into drop_id
  from public.document_stands
  where project_id='29c0726b-3e1e-4f48-81d3-b0f90d324d56'
    and category='schnitte_ansichten'
  order by created_at
  limit 1;

  if keep_id is not null then
    update public.document_stands
      set category='plaene',
          label='Bisheriger Projekt-Hub',
          is_current=false,
          updated_at=now()
    where id=keep_id;

    update public.documents
      set category='plaene',
          stand_id=keep_id,
          document_kind='plan'
    where project_id='29c0726b-3e1e-4f48-81d3-b0f90d324d56'
      and category in ('grundrisse','schnitte_ansichten');
  end if;

  if drop_id is not null and drop_id is distinct from keep_id then
    update public.documents set stand_id=keep_id where stand_id=drop_id;
    delete from public.document_stands where id=drop_id;
  end if;
end $$;

update public.documents
set document_kind='terminplan'
where category='terminplan';

insert into public.document_stands(
  project_id,category,label,stand_date,note,sort_order,is_current
)
select
  '29c0726b-3e1e-4f48-81d3-b0f90d324d56',
  'plaene',
  'VA01',
  date '2026-08-13',
  'Index VA01',
  10,
  true
where not exists (
  select 1 from public.document_stands
  where project_id='29c0726b-3e1e-4f48-81d3-b0f90d324d56'
    and category='plaene'
    and label='VA01'
    and stand_date=date '2026-08-13'
);

update public.document_stands
set is_current=(label='VA01' and stand_date=date '2026-08-13'),
    updated_at=now()
where project_id='29c0726b-3e1e-4f48-81d3-b0f90d324d56'
  and category='plaene';

alter table public.document_stands
  add constraint document_stands_category_check
  check (category = 'plaene');

alter table public.documents
  add constraint documents_category_check
  check (category in ('plaene','terminplan','dokumente'));

alter table public.documents
  drop constraint if exists documents_document_kind_check;

alter table public.documents
  add constraint documents_document_kind_check
  check (document_kind in ('plan','terminplan','praesentation','protokoll','sonstiges'));

create index if not exists documents_project_category_date_idx
  on public.documents(project_id,category,document_date desc,sort_order,title);
