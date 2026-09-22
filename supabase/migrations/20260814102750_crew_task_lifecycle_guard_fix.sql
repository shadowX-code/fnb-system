-- PostgreSQL resolves OLD against the trigger table row type. Branch on the
-- table before referencing item-only columns such as template_id.
create or replace function public.crew_operations_template_guard()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if current_setting('feedx.operation_lifecycle',true) in ('activate','archive','schedule') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_table_name='crew_operation_templates' then
    if old.status<>'draft' then
      raise exception using errcode='55000',message='Active and historical Task revisions are immutable.';
    end if;
  elsif tg_table_name='crew_operation_template_items' then
    if exists(
      select 1 from public.crew_operation_templates t
      where t.id=old.template_id and t.status<>'draft'
    ) then
      raise exception using errcode='55000',message='Active and historical Task content is immutable.';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.crew_operations_template_guard() from public,anon,authenticated;
