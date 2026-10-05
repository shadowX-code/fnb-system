-- Extend the existing authorized finalized record read with pinned daily evidence.
-- No current source resolution, mutable master fallback or snapshot rewrite.
do $$ declare definition text; anchor text; replacement text; begin
 definition:=pg_get_functiondef('public.payroll_finalized_record_read(uuid)'::regprocedure);
 anchor:=$anchor$'employee_id',p.employee_id,'employee_name',p.employee_name_snapshot,$anchor$;
 replacement:=$replacement$'employee_id',p.employee_id,'employee_name',p.employee_name_snapshot,
      'time',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object(
        'id',s.time_version_id,'work_date',s.work_date,'evidence',s.evidence,
        'approved_minutes',s.approved_minutes,'approved_extra_minutes',s.approved_extra_minutes,
        'classification',s.classification,
        'review_state',jsonb_build_object('required',false,'automatic',false,'state',
          case when s.classification in ('public_holiday','public_holiday_ot')
            or s.evidence#>>'{paid_holiday_policy,status}'='paid_holiday' then 'ph_review' else 'ready' end),
        'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'revision',h.revision,
          'status',h.status,'approved_minutes',h.approved_minutes,
          'approved_extra_minutes',h.approved_extra_minutes,'reason',h.decision_reason,
          'actor_employee_id',h.actor_employee_id,'at',h.decided_at) order by h.revision desc)
          from public.payroll_payable_time_versions h where h.profile_id=t.profile_id
            and h.work_date=s.work_date and h.revision<=t.revision),'[]'::jsonb)
      ) order by s.work_date) from public.payroll_run_time_snapshots s
        join public.payroll_payable_time_versions t on t.id=s.time_version_id
        where s.run_id=v_run.id and s.employee_id=p.employee_id),'[]'::jsonb),$replacement$;
 if position(anchor in definition)=0 then raise exception 'Finalized Payroll read contract changed'; end if;
 execute replace(definition,anchor,replacement);
end $$;
