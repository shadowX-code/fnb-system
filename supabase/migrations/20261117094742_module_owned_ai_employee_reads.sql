-- Module-owned employee directory evidence. Same employee RLS as Admin Employees;
-- no join fan-out, credentials, private contacts, payroll or identity documents.
create or replace function public.employee_directory_read(
 p_mode text default 'summary', p_employee_id uuid default null,
 p_status text default 'all', p_legal_entity_id uuid default null,
 p_workplace text default null, p_query text default '', p_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.current_user_has_permission('employees.view') then
  raise exception using errcode='42501',message='Employee view permission required';
 end if;
 if p_mode is null or p_mode not in ('summary','list','detail') or p_status is null
 or p_status not in ('all','active','inactive','resigned','terminated')
 or p_page is null or p_page<1 or p_page>1000 or p_query is null or length(p_query)>80
 or (p_mode='detail' and p_page<>1) or length(p_workplace)>120 or (p_mode='detail')<>(p_employee_id is not null) then
  raise exception using errcode='22023',message='Invalid employee query';
 end if;
 with scoped as materialized (
  select e.id,e.full_name,e.employee_code,coalesce(e.employment_status,'active') employment_status,
   coalesce(e.employment_type,'probation') employment_type,e.legal_entity_id,e.workplace,e.department,e.position,e.updated_at
  from public.employees e
  where (p_employee_id is null or e.id=p_employee_id)
   and (p_legal_entity_id is null or e.legal_entity_id=p_legal_entity_id)
   and (p_workplace is null or coalesce(e.workplace,'')=p_workplace)
   and (p_query='' or strpos(lower(coalesce(e.full_name,'')),lower(trim(p_query)))>0
        or strpos(lower(coalesce(e.employee_code,'')),lower(trim(p_query)))>0)
   and (p_status='all' or (p_status='inactive' and e.employment_status in ('resigned','terminated'))
        or coalesce(e.employment_status,'active')=p_status)
 ), counts as (
  select count(*) total,count(*) filter(where employment_status='active') active,
   count(*) filter(where employment_status in ('resigned','terminated')) inactive,
   count(*) filter(where employment_status='resigned') resigned,
   count(*) filter(where employment_status='terminated') terminated,
   count(*) filter(where employment_status not in ('active','resigned','terminated')) other
  from scoped
 ), page_rows as (
  select * from scoped order by full_name nulls last,id limit 20 offset (p_page-1)*20
 ) select jsonb_build_object('schema_version',1,'as_of',transaction_timestamp(),'mode',p_mode,
  'summary',to_jsonb(counts),'rows',case when p_mode='summary' then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from page_rows p) end,
  'page',p_page,'page_size',20,'total_count',counts.total,
  'has_more',p_mode<>'summary' and counts.total>p_page*20,
  'aggregate_complete',true,'scope','Current human RLS-visible Employees matching the requested filters',
  'status_definition','Employment active/resigned/terminated, not login access. Null status/type use canonical Employees active/probation defaults; other statuses remain separate.') into result from counts;
 if p_mode='detail' and (result->>'total_count')::bigint=0 then
  raise exception using errcode='42501',message='Employee unavailable in authorized scope';
 end if;
 return result;
end $$;
revoke all on function public.employee_directory_read(text,uuid,text,uuid,text,text,integer) from public,anon;
grant execute on function public.employee_directory_read(text,uuid,text,uuid,text,text,integer) to authenticated;

-- Extend the existing allowlist, without enabling or rewriting any policy.
do $$ declare d text:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure);
begin
 if strpos(d, $needle$coalesce(p_payload->>'operation','') not in ('read_recipe_ingredients'$needle$)=0 then raise exception 'Expected capability allowlist missing'; end if;
 execute replace(d,$needle$coalesce(p_payload->>'operation','') not in ('read_recipe_ingredients'$needle$,$replacement$coalesce(p_payload->>'operation','') not in ('read_employee_directory','read_recipe_ingredients'$replacement$);
end $$;
