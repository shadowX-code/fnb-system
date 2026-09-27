-- A stale authoring snapshot is a business conflict, not a retryable SQL serialization failure.
create or replace function public.payroll_statutory_setup_confirm(p_profile_id uuid,p_effective_from date,p_applicability jsonb,
  p_categories jsonb,p_fingerprint text,p_source_note text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; s text; category text; suggestion text; categories jsonb:='{}'; manual boolean:=false;
  actor uuid:=public.payroll_admin_actor(); applicability_id uuid; category_id uuid; source text; reason text;
begin
  perform 1 from public.payroll_profiles where id=p_profile_id for update;
  if not exists(select 1 from public.payroll_profiles p where p.id=p_profile_id and public.payroll_can_access_employee(p.employee_id,'payroll.manage')) then
    raise exception using errcode='42501',message='Payroll statutory setup scope denied.';
  end if;
  r:=public.payroll_statutory_setup_read(p_profile_id,p_effective_from,p_applicability);
  if r->>'fingerprint' is distinct from p_fingerprint then
    raise exception using errcode='PT409',message='Statutory information was updated',
      detail='payroll_statutory_setup_stale';
  end if;
  if p_effective_from is null or p_effective_from <= (r->>'latest_effective_from')::date then
    raise exception using errcode='22023',message='Choose a later effective date',
      detail=jsonb_build_object('latest_effective_from',r->>'latest_effective_from')::text;
  end if;
  foreach s in array array['epf','socso','eis','pcb'] loop
    if (p_applicability->>s) is null then raise exception using errcode='22023',message='Confirm applicability for every scheme.'; end if;
    if s='pcb' or (p_applicability->>s)::boolean=false then continue; end if;
    category:=nullif(p_categories->>s,''); suggestion:=r->'schemes'->s->>'recommendation';
    if category is distinct from suggestion then manual:=true; end if;
    if category is not null and public.payroll_statutory_category_issue(s,category,r->'evidence'->>'nationality',
      (r->'evidence'->>'birthday')::date,date_trunc('month',p_effective_from)::date,
      (date_trunc('month',p_effective_from)+interval '1 month - 1 day')::date) is not null then
      raise exception using errcode='22023',message='Category is unsupported by canonical employee evidence.';
    end if;
    if category is null then manual:=true; end if;
    categories:=categories||jsonb_build_object(s,category);
  end loop;
  if manual and (char_length(btrim(coalesce(p_source_note,'')))<8 or char_length(btrim(coalesce(p_reason,'')))<3) then
    raise exception using errcode='22023',message='Complete Setup or an override requires evidence and reason.';
  end if;
  source:=case when manual then btrim(p_source_note) else 'FeedX canonical Employee and Payroll evidence: '||(r->'evidence')::text end;
  reason:=case when manual then btrim(p_reason) else 'Admin confirmed unified statutory setup' end;
  -- Existing guarded append-only commands run in ONE transaction and ONE effective event.
  applicability_id:=public.payroll_statutory_adjust(p_profile_id,p_effective_from,(p_applicability->>'epf')::boolean,
    (p_applicability->>'socso')::boolean,(p_applicability->>'eis')::boolean,(p_applicability->>'pcb')::boolean,reason);
  category_id:=public.payroll_statutory_input_adjust(p_profile_id,p_effective_from,categories->>'epf',categories->>'socso',categories->>'eis','{}',source,reason);
  return public.payroll_statutory_setup_resolve(p_profile_id,p_effective_from,null)||jsonb_build_object('applicability_version_id',applicability_id,'category_version_id',category_id);
end; $$;
revoke all on function public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text) from public,anon;
grant execute on function public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text) to authenticated;
