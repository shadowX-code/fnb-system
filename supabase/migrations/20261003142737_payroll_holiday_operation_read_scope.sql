-- Shared holiday reads honor the existing Payroll permission/outlet boundary.
create or replace function public.payroll_holiday_operation_read(p_outlet_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.payroll_admin_actor(); result jsonb;
begin
 if not public.current_user_has_permission('payroll.view') then raise exception using errcode='42501',message='Payroll view authority required.'; end if;
 if p_outlet_id is not null and (not exists(select 1 from public.outlets where id=p_outlet_id) or not public.current_user_can_access_outlet(p_outlet_id)) then raise exception using errcode='42501',message='Workplace access required.'; end if;
 select jsonb_build_object('outlets',coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'state_code',v.state_code,'state_revision_id',v.id) order by o.name),'[]'),
  'geographies',coalesce(jsonb_agg(distinct v.state_code) filter(where v.state_code is not null),'[]'),
  'unverified_count',count(*) filter(where v.state_code is null)) into result
 from public.outlets o left join lateral (select id,state_code from public.payroll_outlet_state_versions where outlet_id=o.id
  and effective_from<=timezone('Asia/Kuala_Lumpur',now())::date order by effective_from desc,created_at desc limit 1) v on true
 where (p_outlet_id is null or o.id=p_outlet_id) and public.current_user_can_access_outlet(o.id);
 return result;
end $$;
