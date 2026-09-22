-- Keep published Task revisions immutable while avoiding record-field access
-- for the wrong trigger table. PostgreSQL does not guarantee short-circuit
-- evaluation of the prior combined condition.
create or replace function public.crew_operations_template_guard()
returns trigger language plpgsql set search_path=public as $$
begin
 if current_setting('feedx.operation_lifecycle',true) in ('activate','archive') then
   return case when tg_op='DELETE' then old else new end;
 end if;
 if tg_table_name='crew_operation_templates' then
   if old.status<>'draft' then raise exception using errcode='55000',message='Active and archived Task revisions are immutable.'; end if;
 elsif tg_table_name='crew_operation_template_items' then
   if exists(select 1 from public.crew_operation_templates t where t.id=old.template_id and t.status<>'draft') then raise exception using errcode='55000',message='Active and archived Task content is immutable.'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.crew_operations_template_guard() from public,anon,authenticated;
