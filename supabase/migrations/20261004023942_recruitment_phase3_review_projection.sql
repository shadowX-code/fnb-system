-- Preserve pagination and canonical scoped reads; project manager-owned application state.
alter function public.recruitment_admin_data(integer,integer) rename to recruitment_admin_data_phase1;
revoke all on function public.recruitment_admin_data_phase1(integer,integer) from public,anon,authenticated;
create function public.recruitment_admin_data(p_page integer default 1,p_page_size integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb:=recruitment_admin_data_phase1(p_page,p_page_size); rows jsonb;
begin
 select coalesce(jsonb_agg(x.value||jsonb_build_object('decision_state',a.decision_state,'employee_id',a.employee_id,'workplace',a.workplace_snapshot,'recording_state',t.recording_state) order by x.ordinality),'[]'::jsonb) into rows
 from jsonb_array_elements(d->'applications') with ordinality x(value,ordinality)
 join recruitment_applications a on a.id=(x.value->>'id')::uuid
 left join lateral(select recording_state from recruitment_interview_attempts where application_id=a.id order by created_at desc limit 1) t on true;
 return jsonb_set(d,'{applications}',rows);
end $$;
revoke all on function public.recruitment_admin_data(integer,integer) from public,anon,authenticated;
grant execute on function public.recruitment_admin_data(integer,integer) to authenticated;
