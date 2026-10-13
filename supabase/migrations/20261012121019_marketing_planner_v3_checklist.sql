-- Checklist remains revision-bound production evidence; completion grants no approval.
alter table public.marketing_creative_tasks add column checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array');
create or replace function public.marketing_planner_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare actor uuid;permission text;fp text;prior public.marketing_requests;t public.marketing_creative_tasks;tpl public.marketing_creative_templates;
 result jsonb;month date;week date;asset uuid;link text;content jsonb;d date;generated integer:=0;skipped integer:=0;expected integer;owner_id uuid;assignee uuid;step jsonb;
begin
 permission:=case p_action when 'open_month' then 'view' when 'create' then 'create' when 'save' then 'edit' when 'transition' then 'edit'
 when 'approve' then 'approve' when 'request_revision' then 'approve' when 'delete' then 'delete' when 'target' then 'configure'
 when 'template' then 'manage' when 'generate' then 'manage' when 'skip_occurrence' then 'manage' when 'handoff' then 'edit' end;
 if permission is null or p_request is null or p_revision is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>32768 then raise exception 'Provide a valid planner action.';end if;
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_planner.'||permission);
 month:=coalesce(nullif(p_payload->>'month','')::date,date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))::date);
 if extract(day from month)<>1 then raise exception 'Choose a planning month.';end if;
 fp:=md5(jsonb_build_array(p_org,p_brand,p_action,p_id,p_revision,p_payload)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry payload changed. Use a new request.';end if;return prior.result;end if;
 if p_action not in ('open_month','generate') and p_brand is null then raise exception 'Choose a brand.';end if;
 perform marketing_private.creative_open_month(p_org,p_brand,month,actor);
 if p_action in ('save','transition','approve','request_revision','delete','handoff') then
  select * into t from public.marketing_creative_tasks where id=p_id and organization_id=p_org and brand_id=p_brand and deleted_at is null for update;
  if not found then raise exception using errcode='42501',message='Task is unavailable.';end if;
  if t.revision<>p_revision then raise exception using errcode='40001',message='Task changed. Reload before continuing.';end if;
 end if;
 if p_action='open_month' then result:=jsonb_build_object('month',month);
 elsif p_action in ('create','save') then
  if p_action='create' then
   if p_id is not null or p_revision<>0 then raise exception 'Use a new task.';end if;
   t.organization_id:=p_org;t.brand_id:=p_brand;t.created_by:=actor;t.priority:='normal';t.brief:='';t.asset_ids:='{}';t.reference_links:='[]';t.checklist:='[]';t.status:='planned';t.blocked:=false;t.blocker_reason:='';t.review_feedback:='';
  end if;
  t.title:=trim(coalesce(p_payload->>'title',t.title));t.content_type:=coalesce(p_payload->>'content_type',t.content_type);
  t.due_date:=coalesce(nullif(p_payload->>'due_date','')::date,t.due_date);
  t.planned_publish_date:=case when p_payload?'planned_publish_date' then nullif(p_payload->>'planned_publish_date','')::date else t.planned_publish_date end;
  t.planning_month:=case when p_action='create' or p_payload?'month' then month else t.planning_month end;
  t.planned_week:=case when p_payload?'planned_week' then nullif(p_payload->>'planned_week','')::date else coalesce(t.planned_week,date_trunc('week',greatest(month,least(t.due_date,(month+interval '1 month'-interval '1 day')::date)))::date) end;
  if t.planned_week is null or extract(isodow from t.planned_week)<>1 or t.planned_week>t.planning_month+interval '1 month'-interval '1 day' or t.planned_week+6<t.planning_month then raise exception 'Select a week within the planning month.';end if;
  t.priority:=coalesce(p_payload->>'priority',t.priority);t.brief:=coalesce(p_payload->>'brief',t.brief);
  t.assignee_id:=case when p_payload?'assignee_id' then nullif(p_payload->>'assignee_id','')::uuid else t.assignee_id end;
  t.blocked:=coalesce((p_payload->>'blocked')::boolean,t.blocked);
  t.blocker_reason:=coalesce(p_payload->>'blocker_reason',t.blocker_reason);
  t.blocker_owner:=case when p_payload?'blocker_owner' then nullif(p_payload->>'blocker_owner','')::uuid else t.blocker_owner end;
  if not marketing_private.creative_assignee_allowed(p_org,p_brand,t.assignee_id) or not marketing_private.creative_assignee_allowed(p_org,p_brand,t.blocker_owner) then raise exception 'Choose an authorized brand team member.';end if;
  t.checklist:=coalesce(p_payload->'checklist',t.checklist);
  if jsonb_typeof(t.checklist)<>'array' or jsonb_array_length(t.checklist)>30 then raise exception 'Use up to thirty production steps.';end if;
  for step in select jsonb_array_elements(t.checklist) loop
   if jsonb_typeof(step)<>'object' or jsonb_typeof(step->'text') is distinct from 'string' or length(trim(step->>'text')) not between 1 and 300 or jsonb_typeof(step->'done') is distinct from 'boolean' or (step - 'text' - 'done')<>'{}'::jsonb then raise exception 'Provide a step description and completion state.';end if;
  end loop;
  t.reference_links:=coalesce(p_payload->'reference_links',t.reference_links);
  if jsonb_typeof(t.reference_links)<>'array' or jsonb_array_length(t.reference_links)>10 then raise exception 'Use up to ten HTTPS reference links.';end if;
  for link in select jsonb_array_elements_text(t.reference_links) loop if link!~'^https://' or length(link)>2000 then raise exception 'Use HTTPS reference links.';end if;end loop;
  if p_payload?'asset_ids' then select coalesce(array_agg(value::uuid),'{}') into t.asset_ids from jsonb_array_elements_text(p_payload->'asset_ids');end if;
  if cardinality(t.asset_ids)>10 then raise exception 'Use up to ten media references.';end if;
  for asset in select unnest(t.asset_ids) loop
   perform 1 from public.marketing_assets where id=asset and organization_id=p_org and brand_id=p_brand and state='ready' for update;
   if not found then raise exception 'Choose available media belonging to this brand.';end if;
  end loop;
  if p_action='create' then
   insert into public.marketing_creative_tasks(organization_id,brand_id,title,content_type,due_date,planned_publish_date,planning_month,planned_week,priority,brief,assignee_id,blocked,blocker_reason,blocker_owner,reference_links,asset_ids,checklist,created_by,updated_by)
   values(p_org,p_brand,t.title,t.content_type,t.due_date,t.planned_publish_date,t.planning_month,t.planned_week,t.priority,t.brief,t.assignee_id,t.blocked,t.blocker_reason,t.blocker_owner,t.reference_links,t.asset_ids,t.checklist,actor,actor) returning * into t;
  else
   update public.marketing_creative_tasks set title=t.title,content_type=t.content_type,due_date=t.due_date,planned_publish_date=t.planned_publish_date,planning_month=t.planning_month,planned_week=t.planned_week,
   priority=t.priority,brief=t.brief,assignee_id=t.assignee_id,blocked=t.blocked,blocker_reason=t.blocker_reason,blocker_owner=t.blocker_owner,reference_links=t.reference_links,asset_ids=t.asset_ids,checklist=t.checklist,
   status=case when status in ('in_review','completed') then 'in_progress' else status end,approved_revision=null,revision=revision+1,updated_by=actor,updated_at=now() where id=t.id returning * into t;
  end if;
 elsif p_action='transition' then
  if (p_payload->>'status'='in_progress' and t.status in ('planned','revision_needed')) or (p_payload->>'status'='planned' and t.status in ('in_progress','revision_needed'))
  or (p_payload->>'status'='in_review' and t.status in ('in_progress','revision_needed') and not t.blocked) then
   update public.marketing_creative_tasks set status=p_payload->>'status',revision=revision+1,approved_revision=null,updated_by=actor,updated_at=now() where id=t.id returning * into t;
  else raise exception 'This workflow move is unavailable. Completed work requires reviewer approval; blocked work cannot enter review.';end if;
 elsif p_action in ('approve','request_revision') then
  if t.status<>'in_review' or t.blocked then raise exception 'Review the current unblocked task first.';end if;
  if p_action='request_revision' and length(trim(coalesce(p_payload->>'feedback','')))=0 then raise exception 'Describe the changes needed.';end if;
  update public.marketing_creative_tasks set status=case when p_action='approve' then 'completed' else 'revision_needed' end,
  revision=revision+1,approved_revision=case when p_action='approve' then revision+1 else null end,review_feedback=left(coalesce(p_payload->>'feedback',''),2000),updated_by=actor,updated_at=now() where id=t.id returning * into t;
 elsif p_action='delete' then
  update public.marketing_creative_tasks set deleted_at=now(),revision=revision+1,approved_revision=case when status='completed' then revision+1 else null end,updated_by=actor,updated_at=now() where id=t.id returning * into t;
  update marketing_private.creative_occurrences set skipped=true where task_id=t.id;
 elsif p_action='handoff' then
  if t.status<>'completed' or t.approved_revision is distinct from t.revision then raise exception 'Complete creative review before creating or linking a draft.';end if;
  if t.linked_content_id is not null then result:=jsonb_build_object('content_id',t.linked_content_id);else
   perform marketing_private.require_access(p_org,p_brand,'marketing_content.view');
   if nullif(p_payload->>'content_id','') is not null then
    select jsonb_build_object('id',c.id) into content from public.marketing_content c where c.id=(p_payload->>'content_id')::uuid and c.organization_id=p_org and c.brand_id=p_brand and c.status='draft';
    if content is null then raise exception 'Choose an existing draft belonging to this brand.';end if;
   else
    if t.content_type not in ('post','reel') then raise exception 'This content type can link an existing draft. Create supported publishing variants in Content Management.';end if;
    content:=public.marketing_content_command(gen_random_uuid(),'save',p_org,p_brand,null,0,jsonb_build_object('title',t.title,'outlet_ids','[]'::jsonb,
      'planned_at',case when t.planned_publish_date is not null then (t.planned_publish_date::timestamp at time zone 'Asia/Kuala_Lumpur') else null end,
      'creative_brief',t.brief,'planner_type',t.content_type,'variants',jsonb_build_array(jsonb_build_object('channel','facebook','format',case when t.content_type='reel' then 'reel' when cardinality(t.asset_ids)=0 then 'text' when cardinality(t.asset_ids)=1 then 'image' else 'carousel' end,'caption',left(t.brief,63206),'asset_ids',to_jsonb(t.asset_ids)))));
   end if;
   update public.marketing_creative_tasks set linked_content_id=(content->>'id')::uuid,revision=revision+1,approved_revision=revision+1,updated_by=actor,updated_at=now() where id=t.id returning * into t;
   result:=jsonb_build_object('content_id',t.linked_content_id);
  end if;
 elsif p_action='target' then
  expected:=p_revision;
  perform 1 from public.brands where id=p_brand for update;
  if coalesce(p_payload->>'mode','month')='default' then
   if coalesce((select revision from public.marketing_creative_target_defaults where brand_id=p_brand),0)<>expected then raise exception 'Targets changed. Reload.';end if;
   insert into public.marketing_creative_target_defaults(brand_id,posts,reels,updated_by) values(p_brand,(p_payload->>'posts')::integer,(p_payload->>'reels')::integer,actor)
   on conflict(brand_id) do update set posts=excluded.posts,reels=excluded.reels,revision=marketing_creative_target_defaults.revision+1,updated_by=actor,updated_at=now();
  else
   if (select revision from public.marketing_creative_month_targets where brand_id=p_brand and marketing_creative_month_targets.month=month)<>expected then raise exception 'Monthly targets changed. Reload.';end if;
   update public.marketing_creative_month_targets set posts=(p_payload->>'posts')::integer,reels=(p_payload->>'reels')::integer,overridden=true,revision=revision+1,updated_by=actor,updated_at=now() where brand_id=p_brand and marketing_creative_month_targets.month=month;
  end if;result:=jsonb_build_object('saved',true);
 elsif p_action='template' then
  assignee:=nullif(p_payload->>'assignee_id','')::uuid;
  if not marketing_private.creative_assignee_allowed(p_org,p_brand,assignee) then raise exception 'Choose an authorized brand team member.';end if;
  if p_id is null then
   insert into public.marketing_creative_templates(organization_id,brand_id,title,content_type,frequency,day,assignee_id,brief,created_by)
   values(p_org,p_brand,trim(p_payload->>'title'),p_payload->>'content_type',p_payload->>'frequency',(p_payload->>'day')::integer,assignee,coalesce(p_payload->>'brief',''),actor) returning * into tpl;
  else
   select * into tpl from public.marketing_creative_templates where id=p_id and organization_id=p_org and brand_id=p_brand for update;
   if tpl.id is null or tpl.revision<>p_revision then raise exception 'Template changed or is unavailable.';end if;
   update public.marketing_creative_templates set title=trim(p_payload->>'title'),content_type=p_payload->>'content_type',frequency=p_payload->>'frequency',day=(p_payload->>'day')::integer,assignee_id=assignee,brief=coalesce(p_payload->>'brief',''),active=coalesce((p_payload->>'active')::boolean,true),revision=revision+1 where id=tpl.id returning * into tpl;
  end if;result:=to_jsonb(tpl);
 elsif p_action in ('generate','skip_occurrence') then
  if p_action='skip_occurrence' and (p_id is null or nullif(p_payload->>'date','') is null) then raise exception 'Choose a template and occurrence date.';end if;
  for tpl in select * from public.marketing_creative_templates where organization_id=p_org and (p_brand is null or brand_id=p_brand) and (p_id is null or id=p_id) and active and marketing_private.brand_allowed(p_org,brand_id) order by id for update loop
   perform marketing_private.require_access(p_org,tpl.brand_id,'marketing_planner.create');
   if not marketing_private.creative_assignee_allowed(p_org,tpl.brand_id,tpl.assignee_id) then raise exception 'Template assignee no longer has brand access. Edit the template first.';end if;
   for d in select x::date from generate_series(month::timestamp,(month+interval '1 month'-interval '1 day')::timestamp,interval '1 day') x where (tpl.frequency='weekly' and extract(isodow from x)=tpl.day) or (tpl.frequency='monthly' and extract(day from x)=tpl.day) loop
    if p_action='skip_occurrence' and d is distinct from nullif(p_payload->>'date','')::date then continue;end if;
    insert into marketing_private.creative_occurrences(template_id,occurrence_date,template_revision,occurrence_key,skipped) values(tpl.id,d,tpl.revision,case when tpl.frequency='weekly' then date_trunc('week',d)::date else month end,p_action='skip_occurrence') on conflict do nothing;
    if not found then continue;end if;
    if p_action='skip_occurrence' then skipped:=skipped+1;continue;end if;
    insert into public.marketing_creative_tasks(organization_id,brand_id,title,content_type,assignee_id,due_date,planning_month,planned_week,brief,created_by,updated_by)
    values(p_org,tpl.brand_id,tpl.title,tpl.content_type,tpl.assignee_id,d,month,date_trunc('week',d)::date,tpl.brief,actor,actor) returning * into t;
    update marketing_private.creative_occurrences set task_id=t.id where template_id=tpl.id and occurrence_date=d;
    insert into marketing_private.creative_task_revisions values(t.id,t.revision,to_jsonb(t),'generated',actor,now());generated:=generated+1;t.id:=null;
   end loop;
  end loop;
  if p_action='skip_occurrence' and skipped=0 then raise exception 'This date is not a new occurrence. Remove an existing generated task individually, or choose the template weekday/date within this month.';end if;
  result:=jsonb_build_object('generated',generated,'skipped',skipped);
 end if;
 if t.id is not null then
  insert into marketing_private.creative_task_revisions values(t.id,t.revision,to_jsonb(t),p_action,actor,now()) on conflict do nothing;
  result:=coalesce(result,to_jsonb(t));
 end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(p_org,p_brand,'planner_'||p_action,actor,jsonb_build_object('task_id',t.id,'revision',t.revision,'request_id',p_request));
 insert into public.marketing_requests values(p_request,actor,fp,coalesce(result,'{}'));
 return coalesce(result,'{}');
end;$$;

