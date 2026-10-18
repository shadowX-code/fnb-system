-- Canonical Staging only. Disposable CRM Brand, transaction-local customers and evidence; no persistent writes.
begin;
create temporary table crm_sort_context(org uuid,brand uuid,actor uuid,auth_id uuid);
insert into crm_sort_context
 select b.organization_id,gen_random_uuid(),e.id,e.auth_user_id from public.brands b
 join public.organization_memberships m on m.organization_id=b.organization_id
 join public.employees e on e.id=m.employee_id join public.roles r on r.id=e.role_id
 where b.name='QA CRM Import V2 — Disposable' and lower(r.name)='owner' and e.auth_user_id is not null limit 1;
do $$begin if (select count(*) from crm_sort_context)<>1 then raise exception 'Staging disposable Brand/Owner fixture unavailable.';end if;end;$$;
insert into public.brands(id,organization_id,name) select brand,org,'QA Table Sort Rollback '||brand::text from crm_sort_context;
create temporary table crm_sort_expected(id uuid,display_name text,phone_e164 text,birthday date,total_visit numeric,total_spent numeric,avg_spent numeric,last_visit date,member_since date);
insert into crm_sort_expected
 select gen_random_uuid(),'QA Table '||lpad((i%7)::text,2,'0'),'+60999'||lpad(i::text,7,'0'),case when i<42 then date '1980-01-01'+i end,
 case when i<42 then (i%11) end,case when i<42 then (i%11)*110.01 end,case when i<42 then (i%11)*9.9 end,
 case when i<42 then date '2026-01-01'+(i%11) end,case when i<42 then date '2020-01-01'+(i%11) end from generate_series(1,45)i;
insert into public.platform_customers(id,organization_id,display_name,phone_e164,birthday,created_by,active)
 select x.id,c.org,x.display_name,x.phone_e164,x.birthday,c.actor,mod(x.total_visit::int,2)=0 or x.total_visit is null from crm_sort_expected x cross join crm_sort_context c;
insert into public.platform_customer_brands(organization_id,brand_id,customer_id,tags)
 select c.org,c.brand,x.id,array['QA_TABLE_SORT',case when mod(x.total_visit::int,2)=0 then 'EVEN' else 'ODD' end] from crm_sort_expected x cross join crm_sort_context c;
insert into marketing_private.customer_pos_snapshots(organization_id,brand_id,customer_id,source,snapshot_date,metrics,fingerprint,import_request,actor_employee_id)
 select c.org,c.brand,x.id,'QA Table Sort',current_date,jsonb_strip_nulls(jsonb_build_object('total_visit',x.total_visit,'total_spent',x.total_spent,'avg_spent',x.avg_spent,'last_visit',x.last_visit,'member_since',x.member_since)),md5(x.id::text),gen_random_uuid(),c.actor from crm_sort_expected x cross join crm_sort_context c;
grant select on crm_sort_context,crm_sort_expected to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id from crm_sort_context),'role','authenticated')::text,true);
do $$declare c record;key text;direction text;actual jsonb;page1 jsonb;page2 jsonb;page3 jsonb;expected jsonb;filters jsonb:='{"tags":["QA_TABLE_SORT"]}';sort_count int:=0;begin
 select * into c from crm_sort_context;
 foreach key in array array['name','phone_e164','birthday','total_visit','total_spent','avg_spent','last_visit','member_since'] loop
  foreach direction in array array['asc','desc'] loop
   page1:=public.marketing_customers_read(c.org,c.brand,filters||jsonb_build_object('sort',key||'_'||direction),1,20);
   page2:=public.marketing_customers_read(c.org,c.brand,filters||jsonb_build_object('sort',key||'_'||direction),2,20);
   page3:=public.marketing_customers_read(c.org,c.brand,filters||jsonb_build_object('sort',key||'_'||direction),3,20);
   select jsonb_agg(v->>'id' order by n) into actual from jsonb_array_elements((page1->'customers')||(page2->'customers')||(page3->'customers')) with ordinality t(v,n);
   execute format('select jsonb_agg(id::text order by %I %s nulls last,display_name asc nulls last,id) from crm_sort_expected',case when key='name' then 'display_name' else key end,direction) into expected;
   if actual is distinct from expected or page1->>'total'<>'45' then raise exception 'Wrong complete-dataset sort: % %',key,direction;end if;
   if actual is distinct from (select jsonb_agg(v->>'id' order by n) from jsonb_array_elements(public.marketing_customers_read(c.org,c.brand,filters||jsonb_build_object('sort',key||'_'||direction),1,50)->'customers') with ordinality t(v,n)) then raise exception 'Unstable page size: % %',key,direction;end if;
   if (page1->'customers'->0) ? '_sort_row' then raise exception 'Internal order leaked.';end if;
   sort_count:=sort_count+1;
  end loop;
 end loop;
 actual:=public.marketing_customers_read(c.org,c.brand,'{"tags":["QA_TABLE_SORT"],"search":"QA Table 01","status":"active","sort":"total_spent_desc","consent":"required"}',1,100);
 if (actual->>'total')::int<>(select count(*) from crm_sort_expected where display_name='QA Table 01' and (mod(total_visit::int,2)=0 or total_visit is null)) then raise exception 'Filter scope changed.';end if;
 begin perform public.marketing_customers_read(gen_random_uuid(),c.brand,filters,1,20);raise exception 'Cross-tenant read accepted.';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{}',true);
 begin perform public.marketing_customers_read(c.org,c.brand,filters,1,20);raise exception 'Unauthenticated read accepted.';exception when insufficient_privilege then null;end;
 raise notice 'PASS: % typed directions; 3-page/50-row reconciliation; numeric/date/null/zero/tie order; scope, filters and authority.',sort_count;
end;$$;
rollback;
