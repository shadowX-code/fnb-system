-- Preserve unresolved legacy Production equipment coverage and unscheduled disposal evidence.
create or replace function feedx_integrations.mesti_rows(p_from date,p_to date)
returns setof jsonb language sql stable security definer set search_path=public,pg_temp as $$
with days as (select generate_series(p_from,p_to,interval '1 day')::date business_date),
area_expected as (
  select r.id requirement_id,r.logical_requirement_id,l.id subject_id,d.business_date,
    public.factory_mesti_cleaning_occurrence_snapshot(r,l) snapshot
  from public.factory_mesti_cleaning_requirements r
  join public.factory_mesti_cleaning_requirement_locations link on link.requirement_id=r.id
  join public.factory_storage_locations l on l.id=link.location_id and l.status='active'
  cross join days d
  where r.status='active' and r.effective_from<=d.business_date and (r.effective_until is null or d.business_date<r.effective_until)
    and public.factory_mesti_recurrence_due(r.recurrence_type,r.recurrence_weekdays,d.business_date)
), equipment_expected as (
  select r.id requirement_id,r.logical_requirement_id,e.id subject_id,d.business_date,
    jsonb_build_object('task_name',r.task_name,'version_no',r.version_no,'recurrence_type',r.recurrence_type,
      'recurrence_weekdays',r.recurrence_weekdays,'effective_from',r.effective_from,'effective_until',r.effective_until,
      'equipment_code',e.equipment_code,'location_name',l.location_name,'cleaning_method',r.cleaning_method,
      'cleaning_method_reference',r.cleaning_method_reference) snapshot
  from public.factory_mesti_equipment_cleaning_requirements r
  join public.factory_mesti_equipment_cleaning_requirement_equipment link on link.requirement_id=r.id
  join public.factory_equipment e on e.id=link.equipment_id and e.status='active'
  join public.factory_storage_locations l on l.id=e.current_location_id
  cross join days d
  where r.status='active' and r.effective_from<=d.business_date and (r.effective_until is null or d.business_date<r.effective_until)
    and public.factory_mesti_recurrence_due(r.recurrence_type,r.recurrence_weekdays,d.business_date)
), cleaning as (
  select 'cleaning_of_area' module,coalesce(o.due_date,x.business_date) business_date,o.id record_id,
    coalesce(o.logical_requirement_id,x.logical_requirement_id) logical_id,
    coalesce(o.location_id,x.subject_id) subject_id,coalesce(o.requirement_id,x.requirement_id) requirement_id,
    coalesce(o.requirement_snapshot,x.snapshot) snapshot,o.status,o.completed_at,o.verified_at,o.verification_result,
    'scheduled'::text source_type,null::uuid production_id
  from area_expected x full join (select * from public.factory_mesti_cleaning_occurrences where due_date between p_from and p_to) o
    on o.logical_requirement_id=x.logical_requirement_id and o.location_id=x.subject_id and o.due_date=x.business_date
  union all
  select 'cleaning_of_equipment',coalesce(o.due_date,x.business_date),o.id,
    coalesce(o.logical_requirement_id,x.logical_requirement_id),coalesce(o.equipment_id,x.subject_id),
    coalesce(o.requirement_id,x.requirement_id),coalesce(o.requirement_snapshot,x.snapshot),o.status,o.completed_at,o.verified_at,o.verification_result,
    coalesce(o.source_type,'scheduled'),o.production_id
  from equipment_expected x full join (select * from public.factory_mesti_equipment_cleaning_occurrences where due_date between p_from and p_to) o
    on o.source_type='scheduled' and o.logical_requirement_id=x.logical_requirement_id and o.equipment_id=x.subject_id and o.due_date=x.business_date
), cleaning_rows as (
  select jsonb_build_object('module',module,'date',business_date,'requirement',snapshot->>'task_name',
    'evidence_reference',module||':'||business_date||':'||coalesce(record_id::text,logical_id::text||'_'||subject_id::text),
    'status',case when status='unsatisfactory' or verification_result='unsatisfactory' then 'evidence_issues'
      when status in ('completed','verified') and completed_at is null then 'unavailable'
      when status='verified' and (verified_at is null or verification_result is distinct from 'verified') then 'unavailable'
      when status='verified' then 'compliant' when status='completed' then 'awaiting_verification'
      when business_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then 'not_required_yet'
      when business_date=(now() at time zone 'Asia/Kuala_Lumpur')::date then 'due'
      when record_id is null then 'missing' when status in ('pending','missed') then 'overdue' else 'unavailable' end,
    'pending_verification',status='completed',
    'schedule',jsonb_build_object('requirement_id',requirement_id,'logical_requirement_id',logical_id,'subject_id',subject_id,
      'version',snapshot->'version_no','source',source_type,'recurrence',snapshot->'recurrence_type',
      'weekdays',snapshot->'recurrence_weekdays','effective_from',snapshot->'effective_from','effective_until',snapshot->'effective_until'),
    'evidence',jsonb_build_object('record_id',record_id,'record_status',status,'completed_at',completed_at,'verified_at',verified_at,
      'verification_result',verification_result,'production_id',production_id,'location',snapshot->'location_name',
      'equipment_code',snapshot->'equipment_code','cleaning_method',snapshot->'cleaning_method',
      'cleaning_method_reference',snapshot->'cleaning_method_reference'),
    'limitations',case when snapshot->>'cleaning_method' is null then jsonb_build_array('Cleaning Method is Not Specified in this original snapshot; no historical procedure is inferred.') else '[]'::jsonb end) value
  from cleaning
), production_cleaning_gaps as (
  select jsonb_build_object('module','cleaning_of_equipment','date',p.end_date,'requirement','After Production Cleaning',
    'evidence_reference','cleaning_of_equipment:'||p.end_date||':'||p.id||'_'||b.equipment_id,
    'status','unavailable','pending_verification',false,
    'schedule',jsonb_build_object('source','after_production','production_id',p.id,'subject_id',b.equipment_id,'production_sop_id',p.production_sop_id,'sop_version',p.sop_version),
    'evidence',jsonb_build_object('production_id',p.id),
    'limitations',jsonb_build_array('Pinned SOP equipment binding exists but its canonical cleaning occurrence is unavailable; no occurrence or historical snapshot was generated.')) value
  from public.factory_productions p join public.factory_production_sop_equipment b on b.sop_id=p.production_sop_id
  where p.status='completed' and p.end_date between p_from and p_to
    and not exists(select 1 from public.factory_mesti_equipment_cleaning_occurrences o where o.source_type='after_production' and o.production_id=p.id and o.equipment_id=b.equipment_id)
  union all
  select jsonb_build_object('module','cleaning_of_equipment','date',p.end_date,'requirement','Pinned Production Equipment coverage',
    'evidence_reference','cleaning_of_equipment:'||p.end_date||':coverage_'||p.id,
    'status','unavailable','pending_verification',false,
    'schedule',jsonb_build_object('source','after_production','production_id',p.id,'production_sop_id',p.production_sop_id,'sop_version',p.sop_version),
    'evidence',jsonb_build_object('production_id',p.id),
    'limitations',jsonb_build_array('The pinned Production SOP or its Equipment bindings cannot be resolved. Do not infer that no After Production Cleaning was required.'))
  from public.factory_productions p where p.status='completed' and p.end_date between p_from and p_to
    and (not exists(select 1 from public.factory_production_sops s where s.id=p.production_sop_id and s.version=p.sop_version)
      or not exists(select 1 from public.factory_production_sop_equipment b where b.sop_id=p.production_sop_id))
), waste as (
  select d.business_date,r.*,s.id session_id,s.status session_status,s.verified_at,s.submitted_at,
    (select count(*) from public.factory_mesti_waste_disposal_events e where e.session_id=s.id and e.location_id=r.location_id) completed_count
  from public.factory_mesti_waste_disposal_requirements r cross join days d
  left join public.factory_mesti_waste_disposal_sessions s on s.disposal_date=d.business_date
  where r.status='active' and r.effective_from<=d.business_date and (r.effective_until is null or d.business_date<r.effective_until)
    and public.factory_mesti_recurrence_due(r.frequency,r.recurrence_weekdays,d.business_date)
), waste_rows as (
  select jsonb_build_object('module','waste_disposal','date',business_date,'requirement','Waste Disposal',
    'evidence_reference','waste_disposal:'||business_date||':'||id,
    'status',case when completed_count<required_count then case
      when business_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then 'not_required_yet'
      when business_date=(now() at time zone 'Asia/Kuala_Lumpur')::date then 'due'
      when completed_count=0 and session_id is null then 'missing' else 'incomplete' end
      when session_status='verified' then 'compliant' when session_status='submitted' then 'awaiting_verification' else 'incomplete' end,
    'pending_verification',session_status='submitted',
    'schedule',jsonb_build_object('requirement_id',id,'logical_requirement_id',logical_requirement_id,'version',version_no,
      'subject_id',location_id,'recurrence',frequency,'weekdays',recurrence_weekdays,'effective_from',effective_from,'effective_until',effective_until),
    'evidence',jsonb_build_object('session_id',session_id,'record_status',session_status,'required_count',required_count,'completed_count',completed_count,'submitted_at',submitted_at,'verified_at',verified_at),
    'limitations','[]'::jsonb) value from waste
  union all
  select jsonb_build_object('module','waste_disposal','date',s.disposal_date,'requirement','Unscheduled disposal evidence',
    'evidence_reference','waste_disposal:'||s.disposal_date||':session_'||s.id||'_'||e.location_id,
    'status',case when s.status='submitted' then 'awaiting_verification' else 'recorded' end,
    'pending_verification',s.status='submitted','schedule',jsonb_build_object('required',false,'subject_id',e.location_id),
    'evidence',jsonb_build_object('session_id',s.id,'record_status',s.status,'completed_count',count(*),'submitted_at',s.submitted_at,'verified_at',s.verified_at),
    'limitations',jsonb_build_array('Saved disposal events exist on a date without a resolved requirement for this Location; no missing requirement is invented.'))
  from public.factory_mesti_waste_disposal_sessions s join public.factory_mesti_waste_disposal_events e on e.session_id=s.id
  where s.disposal_date between p_from and p_to
    and not exists(select 1 from waste w where w.business_date=s.disposal_date and w.location_id=e.location_id)
  group by s.id,s.disposal_date,s.status,s.submitted_at,s.verified_at,e.location_id
), calibration as (
  select d.business_date,r.*,pass.calibrated_date last_pass,coalesce(public.factory_mesti_calibration_due_date(pass.calibrated_date,r.interval_months),r.effective_from) next_due,
    latest.result last_result,latest.id last_record
  from public.factory_mesti_calibration_requirements r cross join days d
  left join lateral(select c.* from public.factory_mesti_calibration_records c
    where c.logical_requirement_id=r.logical_requirement_id and c.status='verified' and c.result='pass'
      and c.calibrated_date<=d.business_date and c.verified_at < (d.business_date+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    order by c.verified_at desc,c.created_at desc limit 1) pass on true
  left join lateral(select c.* from public.factory_mesti_calibration_records c
    where c.logical_requirement_id=r.logical_requirement_id and c.status='verified' and c.calibrated_date<=d.business_date
      and c.verified_at < (d.business_date+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    order by c.verified_at desc,c.created_at desc limit 1) latest on true
  where r.status='active' and r.effective_from<=d.business_date and (r.effective_until is null or d.business_date<r.effective_until)
), calibration_rows as (
  select jsonb_build_object('module','calibration','date',business_date,'requirement',calibration_type,
    'evidence_reference','calibration:'||business_date||':'||id,
    'status',case when last_result='fail' then 'evidence_issues' when next_due<=business_date and business_date<(now() at time zone 'Asia/Kuala_Lumpur')::date then 'overdue' when next_due<business_date then 'overdue' when next_due=business_date then 'due' else 'not_required' end,
    'pending_verification',false,
    'schedule',jsonb_build_object('requirement_id',id,'logical_requirement_id',logical_requirement_id,'subject_id',equipment_id,
      'version',version_no,'interval_months',interval_months,'next_due',next_due,'effective_from',effective_from,'effective_until',effective_until),
    'evidence',jsonb_build_object('last_valid_calibration',last_pass,'latest_verified_result',last_result,'latest_verified_record_id',last_record),
    'limitations',jsonb_build_array('Calibration validity is evaluated as of the end of this Malaysia business date; only a verified Pass renews validity.')) value
  from calibration
  union all
  select jsonb_build_object('module','calibration','date',c.calibrated_date,'requirement',r.calibration_type,
    'evidence_reference','calibration:'||c.calibrated_date||':record_'||c.id,
    'status',case when c.result='fail' then 'evidence_issues' when c.status='awaiting_verification' then 'awaiting_verification' when c.verified_at is null then 'unavailable' else 'compliant' end,
    'pending_verification',c.status='awaiting_verification',
    'schedule',jsonb_build_object('requirement_id',c.requirement_id,'logical_requirement_id',c.logical_requirement_id,'subject_id',c.equipment_id,'version',r.version_no,'scheduled_due_date',c.scheduled_due_date),
    'evidence',jsonb_build_object('record_id',c.id,'record_status',c.status,'result',c.result,'calibrated_date',c.calibrated_date,'verified_at',c.verified_at),
    'limitations','[]'::jsonb)
  from public.factory_mesti_calibration_records c join public.factory_mesti_calibration_requirements r on r.id=c.requirement_id
  where c.calibrated_date between p_from and p_to
), hygiene_rows as (
  select jsonb_build_object('module','operator_hygiene','date',d.business_date,'requirement','Daily Operator Hygiene Inspection',
    'evidence_reference','operator_hygiene:'||d.business_date||':'||coalesce(s.id::text,'coverage'),
    'status',case when s.id is null then 'unavailable' when counts.failed>0 then 'evidence_issues'
      when counts.inspected=0 or s.status='draft' then 'incomplete' when s.status='submitted' then 'awaiting_verification' else 'recorded' end,
    'pending_verification',s.status='submitted',
    'schedule',jsonb_build_object('expected_personnel','unavailable'),
    'evidence',jsonb_build_object('session_id',s.id,'record_status',s.status,'inspected_count',counts.inspected,'non_compliant_count',counts.failed,'submitted_at',s.submitted_at,'verified_at',s.verified_at),
    'limitations',jsonb_build_array('No authoritative dated inspection population exists. Active Factory employee options are not a historical attendance or required-personnel schedule. Coverage cannot be certified.')) value
  from days d left join public.factory_mesti_operator_hygiene_sessions s on s.inspection_date=d.business_date
  cross join lateral(select count(*) inspected,count(*) filter(where e.overall_result='non_compliant') failed from public.factory_mesti_operator_hygiene_entries e where e.session_id=s.id) counts
), health_rows as (
  select jsonb_build_object('module','health_declaration','date',d.business_date,'requirement','Health Declaration coverage',
    'evidence_reference','health_declaration:'||d.business_date||':coverage','status','unavailable','pending_verification',false,
    'schedule',jsonb_build_object('expected_personnel','unavailable'),
    'evidence',jsonb_build_object('declaration_count',count(h.id)),
    'limitations',jsonb_build_array('No canonical daily required Employee/Visitor population or declaration recurrence exists. Counts cannot prove completeness. Individual identity, health status, symptoms, actions, notes and contacts are withheld.')) value
  from days d left join public.factory_mesti_health_declarations h on h.voided_at is null
    and (h.declared_at at time zone 'Asia/Kuala_Lumpur')::date=d.business_date group by d.business_date
), production as (
  select p.*,
    exists(select 1 from public.factory_production_sops s where s.id=p.production_sop_id and s.version=p.sop_version) sop_resolved,
    qc.expected,qc.missing,qc.incomplete,
    (select count(*) from public.factory_production_qc_results e where
      (e.production_id=p.id or (e.production_id is null and e.job_order_id=p.job_order_id)) and e.checklist_result='fail') failed,
    legacy.expected legacy_expected,
    balances.count balance_count,balances.balance
  from public.factory_productions p
  cross join lateral(
    select count(*) expected,
      count(*) filter(where ev.id is null) missing,
      count(*) filter(where ev.id is not null and ((ev.qc_type='checklist' and ev.checklist_result is null) or (ev.qc_type='remarks' and nullif(btrim(ev.remarks),'') is null))) incomplete,
      count(*) filter(where ev.checklist_result='fail') failed
    from public.factory_production_sop_steps st join public.factory_production_sop_step_qc_checks q on q.sop_step_id=st.id
    left join lateral(select e.* from public.factory_production_qc_results e where e.sop_qc_check_id=q.id
      and (e.production_id=p.id or (e.production_id is null and e.job_order_id=p.job_order_id))
      order by (e.production_id=p.id) desc nulls last,e.created_at desc,e.id limit 1) ev on true
    where st.sop_id=p.production_sop_id
  ) qc
  cross join lateral(select count(*) expected from public.factory_production_sop_steps st where st.sop_id=p.production_sop_id
    and (st.is_qc_checkpoint or st.qc_required_before_completion or st.qc_measurement_type is not null)
    and not exists(select 1 from public.factory_production_sop_step_qc_checks q where q.sop_step_id=st.id)) legacy
  cross join lateral(select count(*) count,(jsonb_agg(jsonb_build_object('batch_balance_id',b.id,'storage_location_id',b.storage_location_id,
    'batch_no',b.batch_no,'manufacturing_date',b.manufacturing_date,'expiry_date',b.expiry_date,'opening_qty',b.opening_qty) order by b.id)->0) balance
    from public.factory_finished_good_batch_balances b where b.production_id=p.id and b.source_type='production') balances
  where p.status='completed' and p.end_date between p_from and p_to
), production_rows as (
  select jsonb_build_object('module','food_processing_control','date',end_date,'requirement','Completed Production QC and verification',
    'evidence_reference','food_processing_control:'||end_date||':'||id,
    'status',case when failed>0 then 'evidence_issues' when not sop_resolved or legacy_expected>0 or missing>0 then 'unavailable' when incomplete>0 then 'incomplete'
      when verification_status='awaiting_verification' then 'awaiting_verification'
      when verification_status='verified' and verified_at is not null then 'compliant' else 'recorded' end,
    'pending_verification',verification_status='awaiting_verification',
    'schedule',jsonb_build_object('source','production_end','production_sop_id',production_sop_id,'sop_version',sop_version),
    'evidence',jsonb_build_object('production_id',id,'production_no',production_no,'batch_no',batch_no,'end_date',end_date,'end_time',end_time,
      'verification_status',verification_status,'verified_at',verified_at,'qc_expected_count',expected+legacy_expected,'qc_missing_count',missing,
      'qc_incomplete_count',incomplete,'qc_failed_count',failed,'qc_requirement_status',case when not sop_resolved then 'unavailable' when expected+legacy_expected=0 then 'no_qc_required' else 'qc_required' end),
    'limitations',case when legacy_expected>0 then jsonb_build_array('Legacy QC points cannot be matched to typed QC evidence with sufficient certainty.') else '[]'::jsonb end) value from production
  union all
  select jsonb_build_object('module','finished_product_storage_control','date',end_date,'requirement','Canonical Production batch storage evidence',
    'evidence_reference','finished_product_storage_control:'||end_date||':'||id,
    'status',case when balance_count<>1 then 'unavailable'
      when balance->>'storage_location_id' is null or balance->>'manufacturing_date' is null or balance->>'expiry_date' is null or nullif(balance->>'batch_no','') is null then 'evidence_issues' else 'recorded' end,
    'pending_verification',false,'schedule',jsonb_build_object('source','production_end'),
    'evidence',jsonb_build_object('production_id',id,'production_no',production_no,'batch_balance_count',balance_count,'batch',balance),
    'limitations',jsonb_build_array('This is canonical batch storage provenance. No temperature telemetry or storage-condition compliance rule is inferred.')) from production
), all_rows as (
  select value from cleaning_rows union all select value from production_cleaning_gaps
  union all select value from waste_rows union all select value from calibration_rows
  union all select value from hygiene_rows union all select value from health_rows union all select value from production_rows
)
select value || jsonb_build_object('severity',case when value->>'status' in ('missing','overdue','evidence_issues') then 'high'
  when value->>'status' in ('unavailable','incomplete','awaiting_verification') then 'medium' else 'info' end,
  'recommended_follow_up',case value->>'status'
    when 'missing' then 'Ask the authorized module owner to investigate the required record and record actual evidence through FeedX.'
    when 'overdue' then 'Ask the authorized module owner to resolve the overdue obligation through the canonical FeedX workflow.'
    when 'evidence_issues' then 'Ask a permitted reviewer to inspect the failed or inconsistent canonical evidence and determine corrective action.'
    when 'awaiting_verification' then 'Ask a reviewer holding the module verification permission to review the saved evidence in FeedX.'
    when 'incomplete' then 'Ask the module owner to finish the existing record/session and submit it through FeedX.'
    when 'unavailable' then 'Ask an authorized FeedX reviewer to resolve the stated evidence or coverage limitation; do not infer compliance.'
    else 'No automatic action. Retain the evidence and coverage limitations.' end)
from all_rows order by value->>'date',value->>'module',value->>'evidence_reference'
$$;
