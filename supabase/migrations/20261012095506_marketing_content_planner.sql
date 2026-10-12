-- Creative production is separate from Content publication and its approval authority.
insert into public.permissions(code,module,description,requires_restaurant_outlet_scope)
select 'marketing_planner.'||action,'Marketing Content Planner',description,false from (values
 ('view','View authorized creative plans.'),('create','Create creative production tasks.'),('edit','Edit and submit creative work.'),
 ('approve','Approve creative production or request revision.'),('delete','Remove or skip creative tasks.'),
 ('configure','Manage brand content targets.'),('manage','Manage and generate recurring creative tasks.')
) p(action,description) on conflict(code) do nothing;

create table public.marketing_creative_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200), content_type text not null check(content_type in ('post','reel','story','photography','design')),
 assignee_id uuid references public.employees(id), due_date date not null, planned_publish_date date,
 planning_month date not null check(extract(day from planning_month)=1), planned_week date not null,
 priority text not null default 'normal' check(priority in ('normal','high')), brief text not null default '' check(length(brief)<=8000),
 reference_links jsonb not null default '[]', asset_ids uuid[] not null default '{}',
 status text not null default 'planned' check(status in ('planned','in_progress','in_review','revision_needed','completed')),
 blocked boolean not null default false, blocker_reason text not null default '' check(length(blocker_reason)<=2000), blocker_owner uuid references public.employees(id),
 review_feedback text not null default '' check(length(review_feedback)<=2000), revision integer not null default 1,
 approved_revision integer, linked_content_id uuid, manual_order numeric not null default 0, deleted_at timestamptz,
 created_by uuid not null references public.employees(id), updated_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id),
 foreign key(linked_content_id,organization_id,brand_id) references public.marketing_content(id,organization_id,brand_id),
 check(not blocked or length(trim(blocker_reason))>0), check(status<>'completed' or approved_revision=revision)
);
create index marketing_creative_tasks_month on public.marketing_creative_tasks(organization_id,planning_month,brand_id) where deleted_at is null;
create index marketing_creative_tasks_assignee on public.marketing_creative_tasks(assignee_id);
create index marketing_creative_tasks_content on public.marketing_creative_tasks(linked_content_id);
create table marketing_private.creative_task_revisions (
 task_id uuid not null references public.marketing_creative_tasks(id), revision integer not null,
 snapshot jsonb not null, action text not null, actor uuid not null references public.employees(id), recorded_at timestamptz not null default now(),primary key(task_id,revision)
);
create table public.marketing_creative_target_defaults (
 brand_id uuid primary key references public.brands(id), posts integer not null check(posts between 0 and 999), reels integer not null check(reels between 0 and 999),
 revision integer not null default 1,updated_by uuid not null references public.employees(id),updated_at timestamptz not null default now()
);
create table public.marketing_creative_month_targets (
 brand_id uuid not null references public.brands(id), month date not null check(extract(day from month)=1),
 posts integer not null check(posts between 0 and 999), reels integer not null check(reels between 0 and 999),
 overridden boolean not null default false,revision integer not null default 1,updated_by uuid not null references public.employees(id),updated_at timestamptz not null default now(),primary key(brand_id,month)
);
create table public.marketing_creative_templates (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,brand_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),content_type text not null check(content_type in ('post','reel','story','photography','design')),
 frequency text not null check(frequency in ('weekly','monthly')),day integer not null,
 assignee_id uuid references public.employees(id), brief text not null default '' check(length(brief)<=8000),
 active boolean not null default true,revision integer not null default 1,created_by uuid not null references public.employees(id),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id),
 check((frequency='weekly' and day between 1 and 7) or (frequency='monthly' and day between 1 and 28))
);
create index marketing_creative_templates_scope on public.marketing_creative_templates(organization_id,brand_id);
create table marketing_private.creative_occurrences (
 template_id uuid not null references public.marketing_creative_templates(id),occurrence_date date not null,
 template_revision integer not null,task_id uuid references public.marketing_creative_tasks(id),skipped boolean not null default false,
 primary key(template_id,occurrence_date)
);
alter table public.marketing_creative_tasks enable row level security;
alter table public.marketing_creative_target_defaults enable row level security;
alter table public.marketing_creative_month_targets enable row level security;
alter table public.marketing_creative_templates enable row level security;
alter table marketing_private.creative_task_revisions enable row level security;
alter table marketing_private.creative_occurrences enable row level security;
revoke all on public.marketing_creative_tasks,public.marketing_creative_target_defaults,public.marketing_creative_month_targets,public.marketing_creative_templates from public,anon,authenticated;

create function marketing_private.creative_assignee_allowed(p_org uuid,p_brand uuid,p_employee uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select p_employee is null or exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
 join public.organization_memberships m on m.employee_id=e.id and m.organization_id=p_org
 where e.id=p_employee and e.auth_user_id is not null and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active
 and (lower(r.name) in ('owner','admin') or exists(select 1 from public.marketing_role_scopes s where s.organization_id=p_org and s.role_id=e.role_id
 and (s.all_brands or exists(select 1 from public.marketing_role_brands rb where rb.organization_id=p_org and rb.role_id=e.role_id and rb.brand_id=p_brand)))));
$$;
create function marketing_private.creative_open_month(p_org uuid,p_brand uuid,p_month date,p_actor uuid) returns void
language sql security definer set search_path=public as $$
 insert into public.marketing_creative_month_targets(brand_id,month,posts,reels,updated_by)
 select b.id,p_month,coalesce(d.posts,0),coalesce(d.reels,0),p_actor from public.brands b
 left join public.marketing_creative_target_defaults d on d.brand_id=b.id where b.organization_id=p_org
 and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id)
 on conflict(brand_id,month) do nothing;
$$;

create function public.marketing_planner_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare actor uuid;permission text;fp text;prior public.marketing_requests;t public.marketing_creative_tasks;tpl public.marketing_creative_templates;
 result jsonb;month date;week date;asset uuid;link text;content jsonb;d date;generated integer:=0;skipped integer:=0;expected integer;owner_id uuid;assignee uuid;
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
   t.organization_id:=p_org;t.brand_id:=p_brand;t.created_by:=actor;t.priority:='normal';t.brief:='';t.asset_ids:='{}';t.reference_links:='[]';t.status:='planned';t.blocked:=false;t.blocker_reason:='';t.review_feedback:='';
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
   insert into public.marketing_creative_tasks(organization_id,brand_id,title,content_type,due_date,planned_publish_date,planning_month,planned_week,priority,brief,assignee_id,blocked,blocker_reason,blocker_owner,reference_links,asset_ids,created_by,updated_by)
   values(p_org,p_brand,t.title,t.content_type,t.due_date,t.planned_publish_date,t.planning_month,t.planned_week,t.priority,t.brief,t.assignee_id,t.blocked,t.blocker_reason,t.blocker_owner,t.reference_links,t.asset_ids,actor,actor) returning * into t;
  else
   update public.marketing_creative_tasks set title=t.title,content_type=t.content_type,due_date=t.due_date,planned_publish_date=t.planned_publish_date,planning_month=t.planning_month,planned_week=t.planned_week,
   priority=t.priority,brief=t.brief,assignee_id=t.assignee_id,blocked=t.blocked,blocker_reason=t.blocker_reason,blocker_owner=t.blocker_owner,reference_links=t.reference_links,asset_ids=t.asset_ids,
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
  for tpl in select * from public.marketing_creative_templates where organization_id=p_org and (p_brand is null or brand_id=p_brand) and (p_id is null or id=p_id) and active and marketing_private.brand_allowed(p_org,brand_id) order by id for update loop
   perform marketing_private.require_access(p_org,tpl.brand_id,'marketing_planner.create');
   if not marketing_private.creative_assignee_allowed(p_org,tpl.brand_id,tpl.assignee_id) then raise exception 'Template assignee no longer has brand access. Edit the template first.';end if;
   for d in select x::date from generate_series(month::timestamp,(month+interval '1 month'-interval '1 day')::timestamp,interval '1 day') x where (tpl.frequency='weekly' and extract(isodow from x)=tpl.day) or (tpl.frequency='monthly' and extract(day from x)=tpl.day) loop
    if p_action='skip_occurrence' and d is distinct from nullif(p_payload->>'date','')::date then continue;end if;
    insert into marketing_private.creative_occurrences(template_id,occurrence_date,template_revision,skipped) values(tpl.id,d,tpl.revision,p_action='skip_occurrence') on conflict do nothing;
    if not found then continue;end if;
    if p_action='skip_occurrence' then skipped:=skipped+1;continue;end if;
    insert into public.marketing_creative_tasks(organization_id,brand_id,title,content_type,assignee_id,due_date,planning_month,planned_week,brief,created_by,updated_by)
    values(p_org,tpl.brand_id,tpl.title,tpl.content_type,tpl.assignee_id,d,month,date_trunc('week',d)::date,tpl.brief,actor,actor) returning * into t;
    update marketing_private.creative_occurrences set task_id=t.id where template_id=tpl.id and occurrence_date=d;
    insert into marketing_private.creative_task_revisions values(t.id,t.revision,to_jsonb(t),'generated',actor,now());generated:=generated+1;t.id:=null;
   end loop;
  end loop;result:=jsonb_build_object('generated',generated,'skipped',skipped);
 end if;
 if t.id is not null then
  insert into marketing_private.creative_task_revisions values(t.id,t.revision,to_jsonb(t),p_action,actor,now()) on conflict do nothing;
  result:=coalesce(result,to_jsonb(t));
 end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(p_org,p_brand,'planner_'||p_action,actor,jsonb_build_object('task_id',t.id,'revision',t.revision,'request_id',p_request));
 insert into public.marketing_requests values(p_request,actor,fp,coalesce(result,'{}'));
 return coalesce(result,'{}');
end;$$;

create function public.marketing_planner_read(p_org uuid,p_month date,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_planner.view');result jsonb;
begin
 if p_month is null or extract(day from p_month)<>1 then raise exception 'Choose a planning month.';end if;
 select jsonb_build_object(
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('brand_name',b.name,'assignee_name',e.full_name,'blocker_owner_name',bo.full_name,'linked_status',c.status,
  'assets',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.marketing_assets a where a.id=any(t.asset_ids)),
  'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',h.revision,'action',h.action,'actor',he.full_name,'date',h.recorded_at,'feedback',h.snapshot->>'review_feedback') order by h.revision desc),'[]') from marketing_private.creative_task_revisions h left join public.employees he on he.id=h.actor where h.task_id=t.id)) order by t.manual_order,t.created_at),'[]')
  from public.marketing_creative_tasks t join public.brands b on b.id=t.brand_id left join public.employees e on e.id=t.assignee_id left join public.employees bo on bo.id=t.blocker_owner left join public.marketing_content c on c.id=t.linked_content_id
  where t.organization_id=p_org and t.planning_month=p_month and t.deleted_at is null and (p_brand is null or t.brand_id=p_brand) and marketing_private.brand_allowed(p_org,t.brand_id)),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'brand_ids',(select coalesce(jsonb_agg(b.id),'[]') from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id)))),'[]') from public.organization_memberships m join public.employees e on e.id=m.employee_id where m.organization_id=p_org and e.auth_user_id is not null and e.is_active and e.enable_system_login and e.access_state='active'),
 'targets',(select coalesce(jsonb_agg(jsonb_build_object('brand_id',b.id,'brand_name',b.name,'posts',mt.posts,'reels',mt.reels,'revision',mt.revision,'overridden',mt.overridden,'default_posts',coalesce(df.posts,0),'default_reels',coalesce(df.reels,0),'default_revision',coalesce(df.revision,0),
  'planned_posts',(select count(*) from public.marketing_creative_tasks t where t.brand_id=b.id and t.planning_month=p_month and t.content_type='post' and t.deleted_at is null),
  'planned_reels',(select count(*) from public.marketing_creative_tasks t where t.brand_id=b.id and t.planning_month=p_month and t.content_type='reel' and t.deleted_at is null),
  'completed_posts',(select count(*) from public.marketing_creative_tasks t where t.brand_id=b.id and t.planning_month=p_month and t.content_type='post' and t.status='completed' and t.deleted_at is null),
  'completed_reels',(select count(*) from public.marketing_creative_tasks t where t.brand_id=b.id and t.planning_month=p_month and t.content_type='reel' and t.status='completed' and t.deleted_at is null),
  'published_posts',(select count(distinct coalesce((select j.content_id::text from public.marketing_jobs j where j.connection_id=s.connection_id and j.provider_post_id=s.provider_post_id and j.channel=s.channel limit 1),s.channel||':'||s.provider_account_id||':'||s.provider_post_id)) from public.marketing_social_posts s where s.brand_id=b.id and timezone(b.timezone,s.published_at)::date>=p_month and timezone(b.timezone,s.published_at)::date<p_month+interval '1 month' and coalesce(s.media_product_type,'')<>'REELS' and coalesce(s.media_type,'')<>'REEL'),
  'published_reels',(select count(distinct coalesce((select j.content_id::text from public.marketing_jobs j where j.connection_id=s.connection_id and j.provider_post_id=s.provider_post_id and j.channel=s.channel limit 1),s.channel||':'||s.provider_account_id||':'||s.provider_post_id)) from public.marketing_social_posts s where s.brand_id=b.id and timezone(b.timezone,s.published_at)::date>=p_month and timezone(b.timezone,s.published_at)::date<p_month+interval '1 month' and (s.media_product_type='REELS' or s.media_type='REEL'))
 ) order by b.name),'[]') from public.brands b join public.marketing_creative_month_targets mt on mt.brand_id=b.id and mt.month=p_month left join public.marketing_creative_target_defaults df on df.brand_id=b.id where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id)),
 'templates',(select coalesce(jsonb_agg(to_jsonb(tp) order by tp.title),'[]') from public.marketing_creative_templates tp where tp.organization_id=p_org and (p_brand is null or tp.brand_id=p_brand) and marketing_private.brand_allowed(p_org,tp.brand_id)),
 'drafts',case when public.current_user_has_permission('marketing_content.view') then (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',c.brand_id,'title',r.payload->>'title') order by c.updated_at desc),'[]') from public.marketing_content c join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision where c.organization_id=p_org and c.status='draft' and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)) else '[]'::jsonb end
 ) into result;return result;
end;$$;

-- Manual order updates lock the month and all exact authorized task revisions atomically.
create function public.marketing_planner_order(p_request uuid,p_org uuid,p_month date,p_tasks jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_planner.edit');item jsonb;t public.marketing_creative_tasks;i integer:=0;fp text;prior public.marketing_requests;
begin
 if p_request is null or jsonb_typeof(p_tasks)<>'array' or jsonb_array_length(p_tasks)>500 or jsonb_array_length(p_tasks)<>(select count(distinct value->>'id') from jsonb_array_elements(p_tasks)) then raise exception 'Provide distinct tasks to order.';end if;
 fp:=md5(jsonb_build_array(p_org,p_month,p_tasks)::text);perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry payload changed.';end if;return prior.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_month::text,1));
 perform 1 from public.marketing_creative_tasks where id in (select (value->>'id')::uuid from jsonb_array_elements(p_tasks)) order by id for update;
 for item in select value from jsonb_array_elements(p_tasks) loop
  select * into t from public.marketing_creative_tasks where id=(item->>'id')::uuid and organization_id=p_org and planning_month=p_month and deleted_at is null;
  if t.id is null or t.revision is distinct from (item->>'revision')::integer then raise exception 'Tasks changed. Reload before ordering.';end if;
  perform marketing_private.require_access(p_org,t.brand_id,'marketing_planner.edit');
  i:=i+1;update public.marketing_creative_tasks set manual_order=i,revision=revision+1,approved_revision=case when status='completed' then revision+1 else null end,updated_by=actor,updated_at=now() where id=t.id returning * into t;
  insert into marketing_private.creative_task_revisions values(t.id,t.revision,to_jsonb(t),'ordered',actor,now());
 end loop;
 insert into public.marketing_requests values(p_request,actor,fp,jsonb_build_object('ordered',i));return jsonb_build_object('ordered',i);
end;$$;
revoke all on function marketing_private.creative_assignee_allowed(uuid,uuid,uuid),marketing_private.creative_open_month(uuid,uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.marketing_planner_read(uuid,date,uuid),public.marketing_planner_command(uuid,uuid,uuid,text,uuid,integer,jsonb),public.marketing_planner_order(uuid,uuid,date,jsonb) from public,anon;
grant execute on function public.marketing_planner_read(uuid,date,uuid),public.marketing_planner_command(uuid,uuid,uuid,text,uuid,integer,jsonb),public.marketing_planner_order(uuid,uuid,date,jsonb) to authenticated;

-- Active creative references participate in the existing snapshot retention authority.
create or replace function public.marketing_media_cleanup_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets;
begin
 for a in select * from public.marketing_assets where storage_policy='temporary' and
 (state='ready' or (state='retiring' and cleanup_started_at<now()-interval '10 minutes')) order by created_at for update skip locked loop
  if exists(select 1 from public.marketing_creative_tasks t where a.id=any(t.asset_ids) and t.deleted_at is null) then continue;end if;
  if exists(select 1 from public.marketing_content c join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision where r.payload::text like '%'||a.id::text||'%' and c.status<>'published') then continue;end if;
  if exists(select 1 from public.marketing_campaign_revisions r where r.payload::text like '%'||a.id::text||'%') or exists(select 1 from marketing_private.ads_changes r where r.configuration::text like '%'||a.id::text||'%') then continue;end if;
  if not exists(select 1 from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision where r.payload::text like '%'||a.id::text||'%' and j.state='succeeded') then continue;end if;
  if exists(select 1 from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision where r.payload::text like '%'||a.id::text||'%' and
   (j.state not in ('succeeded','cancelled') or (j.state='succeeded' and not exists(select 1 from public.marketing_social_posts s where s.connection_id=j.connection_id and s.connection_generation=j.connection_generation and s.provider_post_id=j.provider_post_id and s.channel=j.channel)))) then continue;end if;
  update public.marketing_assets set state='retiring',cleanup_lease=gen_random_uuid(),cleanup_started_at=now() where id=a.id returning * into a;
  return to_jsonb(a);
 end loop;return null;
end;$$;
