-- Versioned Campaign workflows. This phase executes only synthetic rehearsals.
create table marketing_private.whatsapp_workflows (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null, brand_id uuid not null,
 revision integer not null default 1,
 state text not null default 'draft' check(state in ('draft','enabled','paused')),
 created_by uuid not null references public.employees(id),
 updated_at timestamptz not null default now(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
create index whatsapp_workflows_brand on marketing_private.whatsapp_workflows(organization_id,brand_id,updated_at desc,id);

create table marketing_private.whatsapp_workflow_revisions (
 workflow_id uuid not null references marketing_private.whatsapp_workflows(id),
 revision integer not null,
 title text not null check(length(title) between 1 and 120),
 batch_size integer not null check(batch_size between 1 and 100),
 follow_up_hours integer not null check(follow_up_hours in (0,24,48,72)),
 created_by uuid not null references public.employees(id), created_at timestamptz not null default now(),
 primary key(workflow_id,revision)
);

create table marketing_private.whatsapp_workflow_events (
 id uuid primary key, workflow_id uuid not null, revision integer not null,
 action text not null check(action in ('save','enable','pause','simulate')),
 actor_id uuid not null references public.employees(id),
 scenario text, trace jsonb, created_at timestamptz not null default now(),
 foreign key(workflow_id,revision) references marketing_private.whatsapp_workflow_revisions(workflow_id,revision),
 check((action='simulate')=(scenario is not null and trace is not null))
);
create index whatsapp_workflow_events_history on marketing_private.whatsapp_workflow_events(workflow_id,created_at desc,id);

alter table marketing_private.whatsapp_workflows enable row level security;
alter table marketing_private.whatsapp_workflow_revisions enable row level security;
alter table marketing_private.whatsapp_workflow_events enable row level security;
revoke all on marketing_private.whatsapp_workflows,marketing_private.whatsapp_workflow_revisions,marketing_private.whatsapp_workflow_events from public,anon,authenticated,service_role;

create function public.marketing_whatsapp_workflows(p_org uuid,p_brand uuid,p_workflow uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rows_ jsonb; history_ jsonb;
begin
 if p_brand is null then raise exception 'Choose a Brand.';end if;
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id),'[]') into rows_
 from (select w.id,w.revision,w.state,w.updated_at,r.title,r.batch_size,r.follow_up_hours
  from marketing_private.whatsapp_workflows w
  join marketing_private.whatsapp_workflow_revisions r on r.workflow_id=w.id and r.revision=w.revision
  where w.organization_id=p_org and w.brand_id=p_brand and (p_workflow is null or w.id=p_workflow)
  order by w.updated_at desc,w.id limit 100)x;
 if p_workflow is not null then
  if jsonb_array_length(rows_)=0 then raise exception using errcode='42501',message='Workflow unavailable.';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into history_
  from (select e.id,e.revision,e.action,e.scenario,e.trace,e.created_at,r.title,r.batch_size,r.follow_up_hours,
    coalesce(nullif(btrim(a.nickname),''),a.full_name) actor_name
   from marketing_private.whatsapp_workflow_events e join employees a on a.id=e.actor_id
   join marketing_private.whatsapp_workflow_revisions r using(workflow_id,revision)
   where e.workflow_id=p_workflow order by e.created_at desc,e.id limit 50)x;
 end if;
 return jsonb_build_object('rows',rows_,'history',coalesce(history_,'[]'),'live_execution',false);
end;
$$;

create function public.marketing_whatsapp_workflow_command(
 p_request uuid,p_org uuid,p_brand uuid,p_workflow uuid,p_revision integer,p_action text,
 p_title text default null,p_batch integer default null,p_wait integer default null,p_scenario text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid; fingerprint text; old public.marketing_requests; w marketing_private.whatsapp_workflows;
 r marketing_private.whatsapp_workflow_revisions; trace_ jsonb; result jsonb;
begin
 if p_request is null or p_brand is null or p_action is null or p_action not in ('save','enable','pause','simulate') then
  raise exception 'Invalid workflow request.';
 end if;
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 actor:=marketing_private.require_access(p_org,p_brand,case when p_action in ('enable','pause') then 'marketing_campaigns.execute' else 'marketing_campaigns.manage' end);
 fingerprint:=md5(jsonb_build_array('wa_workflow',p_org,p_brand,p_workflow,p_revision,p_action,p_title,p_batch,p_wait,p_scenario)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old from public.marketing_requests where request_id=p_request;
 if found then
  if old.actor_employee_id<>actor or old.fingerprint<>fingerprint then raise exception 'This request has already been used.';end if;
  return old.result;
 end if;
 if not exists(select 1 from public.brands where id=p_brand and organization_id=p_org and is_active) then raise exception 'Brand is inactive.';end if;
 if p_workflow is null then
  if p_action<>'save' or p_revision is distinct from 0 then raise exception 'Save a draft first.';end if;
  perform pg_advisory_xact_lock(hashtextextended('wa_workflows:'||p_brand::text,0));
  if (select count(*) from marketing_private.whatsapp_workflows where brand_id=p_brand)>=100 then raise exception 'This Brand has reached its workflow limit.';end if;
  insert into marketing_private.whatsapp_workflows(organization_id,brand_id,created_by)
   values(p_org,p_brand,actor) returning * into w;
 else
  select * into w from marketing_private.whatsapp_workflows
   where id=p_workflow and organization_id=p_org and brand_id=p_brand for update;
  if not found then raise exception using errcode='42501',message='Workflow unavailable.';end if;
  if w.revision is distinct from p_revision then raise exception 'Workflow changed. Reload and try again.';end if;
 end if;
 if p_action='save' then
  if length(btrim(coalesce(p_title,''))) not between 1 and 120 or p_batch is null or p_batch not between 1 and 100
   or p_wait is null or p_wait not in (0,24,48,72) then raise exception 'Enter a title, a valid batch size and follow-up interval.';end if;
  if w.state='enabled' then raise exception 'Pause this workflow before editing.';end if;
  if p_workflow is not null then
   update marketing_private.whatsapp_workflows set revision=revision+1,state='draft',updated_at=now() where id=w.id returning * into w;
  end if;
  insert into marketing_private.whatsapp_workflow_revisions values(w.id,w.revision,btrim(p_title),p_batch,p_wait,actor,now());
 elsif p_action in ('enable','pause') then
  if (p_action='enable' and w.state='enabled') or (p_action='pause' and w.state<>'enabled') then raise exception 'Workflow state changed. Reload and try again.';end if;
  if p_action='enable' and not exists(select 1 from marketing_private.whatsapp_workflow_events e where e.workflow_id=w.id and e.revision=w.revision and e.action='simulate') then
   raise exception 'Run a simulation on this revision before enabling it.';
  end if;
  update marketing_private.whatsapp_workflows set state=case when p_action='enable' then 'enabled' else 'paused' end,updated_at=now() where id=w.id returning * into w;
 else
  if p_scenario is null or p_scenario not in ('no_reply','details','human','opted_out','undelivered','uncertain','goal_completed','consent_revoked') then
   raise exception 'Select a simulation scenario.';
  end if;
  select * into strict r from marketing_private.whatsapp_workflow_revisions where workflow_id=w.id and revision=w.revision;
  trace_:=jsonb_build_array(jsonb_build_object('step','Campaign starts','result','Fictional recipient enrolled'));
  if p_scenario='opted_out' then
   trace_:=trace_||jsonb_build_object('step','Eligibility','result','Stopped: recipient opted out');
  else
   trace_:=trace_||jsonb_build_object('step','Initial template','result','Would enter a batch of up to '||r.batch_size||' eligible recipients');
   trace_:=trace_||case p_scenario
    when 'details' then jsonb_build_object('step','Customer replies','result','Would open the Campaign conversation; no reminder')
    when 'human' then jsonb_build_object('step','Human request','result','Would enter the staff queue; no reminder')
    when 'undelivered' then jsonb_build_object('step','Delivery failed','result','Stopped: no reminder')
    when 'uncertain' then jsonb_build_object('step','Unknown submission result','result','Stopped: reconcile first; no resend')
    when 'goal_completed' then jsonb_build_object('step','Verified goal completed','result','Stopped: no reminder')
    when 'consent_revoked' then jsonb_build_object('step','Eligibility recheck','result','Stopped: consent withdrawn before reminder')
    else case when r.follow_up_hours=0 then jsonb_build_object('step','No customer reply','result','Ended: reminders disabled')
      else jsonb_build_object('step','Wait '||r.follow_up_hours||' hours','result','Would queue one approved reminder only after a fresh eligibility and delivery check') end
   end;
  end if;
 end if;
 insert into marketing_private.whatsapp_workflow_events(id,workflow_id,revision,action,actor_id,scenario,trace)
  values(p_request,w.id,w.revision,p_action,actor,case when p_action='simulate' then p_scenario end,trace_);
 result:=jsonb_build_object('id',w.id,'revision',w.revision,'state',w.state,'simulation',p_action='simulate','trace',trace_,'live_execution',false);
 insert into public.marketing_requests values(p_request,actor,fingerprint,result);
 return result;
end;
$$;
revoke all on function public.marketing_whatsapp_workflows(uuid,uuid,uuid),
 public.marketing_whatsapp_workflow_command(uuid,uuid,uuid,uuid,integer,text,text,integer,integer,text) from public,anon;
grant execute on function public.marketing_whatsapp_workflows(uuid,uuid,uuid),
 public.marketing_whatsapp_workflow_command(uuid,uuid,uuid,uuid,integer,text,text,integer,integer,text) to authenticated;
