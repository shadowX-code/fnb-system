-- Final FeedX asset condition/status model.
-- Condition = operational state. Status = record lifecycle.

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.asset_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike any (array['%condition%', '%status%'])
  loop
    execute format('alter table public.asset_items drop constraint if exists %I', constraint_record.conname);
  end loop;

  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.asset_inspection_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike any (array['%condition%', '%condition_status%'])
  loop
    execute format('alter table public.asset_inspection_items drop constraint if exists %I', constraint_record.conname);
  end loop;
end $$;

update public.asset_items
set condition = case
  when condition in ('good', 'active') then 'healthy'
  when condition in ('needs_review', 'review', 'need_repair', 'need_repairs') then 'needs_attention'
  when condition = 'inactive' then 'disposed'
  when condition in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed') then condition
  when status in ('damaged', 'missing', 'disposed') then status
  when status = 'inactive' then 'disposed'
  else 'healthy'
end
where condition is null
   or condition not in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed');

update public.asset_items
set status = case
  when status in ('archived', 'inactive') then 'archived'
  else 'active'
end
where status is null
   or status not in ('active', 'archived');

update public.asset_inspection_items
set condition = case
  when condition in ('good', 'active') then 'healthy'
  when condition in ('needs_review', 'review', 'need_repair', 'need_repairs') then 'needs_attention'
  when condition = 'inactive' then 'disposed'
  when condition in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed') then condition
  when condition_status in ('good', 'active') then 'healthy'
  when condition_status in ('needs_review', 'review', 'need_repair', 'need_repairs') then 'needs_attention'
  when condition_status = 'inactive' then 'disposed'
  when condition_status in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed') then condition_status
  else 'healthy'
end
where condition is null
   or condition not in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed');

update public.asset_inspection_items
set condition_status = case
  when condition_status in ('good', 'active') then 'healthy'
  when condition_status in ('needs_review', 'review', 'need_repair', 'need_repairs') then 'needs_attention'
  when condition_status = 'inactive' then 'disposed'
  when condition_status in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed') then condition_status
  when condition in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed') then condition
  else 'healthy'
end
where condition_status is null
   or condition_status not in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed');

alter table public.asset_items
  alter column condition set default 'healthy',
  alter column status set default 'active';

alter table public.asset_items
  add constraint asset_items_condition_check
  check (condition in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed'));

alter table public.asset_items
  add constraint asset_items_status_check
  check (status in ('active', 'archived'));

alter table public.asset_inspection_items
  alter column condition set default 'healthy',
  alter column condition_status set default 'healthy';

alter table public.asset_inspection_items
  add constraint asset_inspection_items_condition_check
  check (condition in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed'));

alter table public.asset_inspection_items
  add constraint asset_inspection_items_condition_status_check
  check (condition_status in ('healthy', 'needs_attention', 'under_maintenance', 'low_quantity', 'damaged', 'missing', 'disposed'));
