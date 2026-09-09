-- Production-owned verification and a read-only MeSTI processing projection.
alter table public.factory_productions add column if not exists verification_status text not null default 'not_required', add column if not exists verified_by uuid references public.employees(id), add column if not exists verified_at timestamptz;
alter table public.factory_productions drop constraint if exists factory_productions_verification_status_check;
alter table public.factory_productions add constraint factory_productions_verification_status_check check (verification_status in ('not_required','awaiting_verification','verified'));
update public.factory_productions set verification_status='awaiting_verification' where status='completed' and verification_status='not_required';
create or replace function public.factory_mark_completed_production_awaiting_verification() returns trigger language plpgsql security definer set search_path=public as $$ begin if new.status='completed' and old.status is distinct from 'completed' then new.verification_status='awaiting_verification'; end if; return new; end $$;
drop trigger if exists factory_mark_completed_production_awaiting_verification on public.factory_productions;
create trigger factory_mark_completed_production_awaiting_verification before insert or update of status on public.factory_productions for each row execute function public.factory_mark_completed_production_awaiting_verification();
insert into public.permissions(code,module,description) values ('factory_production.verify','Factory Production','Verify completed Factory Production records.') on conflict(code) do update set module=excluded.module,description=excluded.description;
create or replace function public.factory_verify_production_record(p_production_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.employees%rowtype; p public.factory_productions%rowtype;
begin
 if auth.uid() is null or not public.current_user_has_permission('factory_production.verify') then raise exception using errcode='42501',message='Missing permission to verify Production Record.'; end if;
 select * into a from public.employees where auth_user_id=auth.uid() and is_active and coalesce(employment_status,'active')='active' order by id limit 1; if not found then raise exception using errcode='42501',message='An active employee profile is required.'; end if;
 select * into p from public.factory_productions where id=p_production_id for update; if not found then raise exception 'Production Record was not found.'; end if;
 if p.verification_status='verified' then return to_jsonb(p); end if;
 if p.status<>'completed' or p.verification_status<>'awaiting_verification' then raise exception 'Only completed Production awaiting verification can be verified.'; end if;
 if p.created_by=a.id then raise exception using errcode='42501',message='Completed By cannot verify the same Production Record.'; end if;
 update public.factory_productions set verification_status='verified',verified_by=a.id,verified_at=now(),updated_at=now() where id=p.id returning * into p;
 return to_jsonb(p);
end $$;
grant execute on function public.factory_verify_production_record(uuid) to authenticated; revoke execute on function public.factory_verify_production_record(uuid) from public,anon;
create or replace function public.factory_mesti_food_processing_control(p_date_from date default null,p_date_to date default null,p_finished_good_id uuid default null,p_qc_status text default null,p_verification_status text default null,p_search text default null) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.completed_at desc,r.id desc),'[]'::jsonb) from (
 select p.id,p.job_order_id,p.finished_good_id,j.job_order_no,p.production_no,p.batch_no,coalesce(p.manufacturing_date,p.production_date,p.completed_at::date) production_date,coalesce(f.product_name_en,f.product_name,p.product_name) product_name,f.product_code,f.variant_name,f.packaging_type,p.start_time,p.completed_at,p.good_output_qty,p.actual_output_qty,p.uom,p.expiry_date,p.notes,p.qc_status,p.verification_status,p.verified_at,coalesce(c.nickname,c.full_name,'') completed_by_name,coalesce(v.nickname,v.full_name,'') verified_by_name,
 case when count(q.id)=0 then 'Evidence unavailable' when count(q.id) filter(where q.checklist_result in ('pass','na') or (q.qc_type='remarks' and q.remarks is not null))=count(q.id) then 'Passed · '||count(q.id)||'/'||count(q.id) else 'Complete · '||count(q.id) filter(where q.checked_at is not null)||'/'||count(q.id) end qc_summary
 from public.factory_productions p left join public.factory_finished_goods f on f.id=p.finished_good_id left join public.factory_job_orders j on j.id=p.job_order_id left join public.employees c on c.id=p.created_by left join public.employees v on v.id=p.verified_by left join public.factory_production_qc_results q on q.production_id=p.id
 where auth.uid() is not null and public.current_user_has_permission('factory_production.view') and p.status='completed' and (p_date_from is null or coalesce(p.manufacturing_date,p.production_date,p.completed_at::date)>=p_date_from) and (p_date_to is null or coalesce(p.manufacturing_date,p.production_date,p.completed_at::date)<=p_date_to) and (p_finished_good_id is null or p.finished_good_id=p_finished_good_id) and (p_qc_status is null or p.qc_status=p_qc_status) and (p_verification_status is null or p.verification_status=p_verification_status) and (nullif(btrim(p_search),'') is null or concat_ws(' ',p.production_no,p.batch_no,p.product_name,f.product_name_en,f.product_code,j.job_order_no) ilike '%'||btrim(p_search)||'%')
 group by p.id,j.job_order_no,f.product_name_en,f.product_name,f.product_code,f.variant_name,f.packaging_type,c.nickname,c.full_name,v.nickname,v.full_name
 ) r;
$$;
grant execute on function public.factory_mesti_food_processing_control(date,date,uuid,text,text,text) to authenticated; revoke execute on function public.factory_mesti_food_processing_control(date,date,uuid,text,text,text) from public,anon;
