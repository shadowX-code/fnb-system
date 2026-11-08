create function marketing_private.validate_ai_flow(p_definition jsonb) returns void
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
 node jsonb; step_id text; step_type text; port text; field_key text; target text;
 seen text[]:='{}'; fields text[]:='{}'; reachable text[]:=array['trigger']; nodes jsonb:=p_definition->'nodes';
begin
 if jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>40000
 or length(btrim(coalesce(p_definition->>'name',''))) not between 1 and 120
 or length(btrim(coalesce(p_definition->>'intent',''))) not between 1 and 300
 or length(coalesce(p_definition->>'description',''))>300 or length(coalesce(p_definition->>'objective',''))>300
 or jsonb_typeof(nodes) is distinct from 'array' or jsonb_typeof(p_definition->'channels') is distinct from 'array' then
  raise exception 'Flow definition is invalid.';
 end if;
 if (p_definition - array['name','intent','description','objective','examples','channels','nodes']) <> '{}'::jsonb
 or jsonb_typeof(p_definition->'name') is distinct from 'string'
 or jsonb_typeof(p_definition->'intent') is distinct from 'string'
 or jsonb_typeof(p_definition->'description') is distinct from 'string'
 or jsonb_typeof(p_definition->'objective') is distinct from 'string'
 or jsonb_typeof(p_definition->'examples') is distinct from 'array'
 or jsonb_array_length(nodes) not between 2 and 40 or jsonb_array_length(p_definition->'channels') not between 1 and 3
 or exists(select 1 from jsonb_array_elements_text(p_definition->'channels') channel where channel is null or channel not in ('facebook','instagram','whatsapp')) then
  raise exception 'Flow steps or channels are invalid.';
 end if;
 if jsonb_array_length(p_definition->'examples')>10 or exists(
  select 1 from jsonb_array_elements(p_definition->'examples') example where jsonb_typeof(example)<>'string' or length(example#>>'{}')>300
 ) then raise exception 'Trigger examples are invalid.';end if;
 for node in select value from jsonb_array_elements(nodes) loop
  step_id:=node->>'id'; step_type:=node->>'type'; field_key:=node->>'field';
  if jsonb_typeof(node) is distinct from 'object' or step_id is null or step_id !~ '^[a-zA-Z0-9_-]{1,40}$' or step_id=any(seen)
   or not step_id=any(reachable) or step_type is null or step_type not in ('trigger','ask','condition','knowledge','reply','handoff','end')
   or (cardinality(seen)=0 and (step_type<>'trigger' or step_id<>'trigger')) or (cardinality(seen)>0 and step_type='trigger')
   or (node-array['id','type','next','yes','no','field','prompt','value_type','required','equals'])<>'{}'::jsonb then
   raise exception 'Each step must be reachable and have a unique ID.';
  end if;
  seen:=array_append(seen,step_id);
  if step_type in ('ask','reply','handoff') and (jsonb_typeof(node->'prompt') is distinct from 'string' or length(btrim(node->>'prompt')) not between 1 and 300) then
   raise exception 'Add a question or message to the step.';
  end if;
  if step_type='ask' then
   if field_key is null or field_key !~ '^[a-z][a-z0-9_]{0,31}$' or field_key=any(fields)
    or coalesce(node->>'value_type','') not in ('text','number','boolean') or jsonb_typeof(node->'required') is distinct from 'boolean' then raise exception 'Invalid collection field.';end if;
   fields:=array_append(fields,field_key);
  end if;
  if step_type='condition' and (field_key is null or not field_key=any(fields) or jsonb_typeof(node->'equals') is distinct from 'string' or length(btrim(node->>'equals')) not between 1 and 300) then
   raise exception 'Invalid condition.';
  end if;
  foreach port in array (case when step_type in ('handoff','end') then '{}'::text[] when step_type='condition' then array['yes','no'] else array['next'] end) loop
   target:=node->>port;
   if target is null or target=any(seen) or not exists(select 1 from jsonb_array_elements(nodes) other where other->>'id'=target) then
    raise exception 'Each branch must go to a later step.';
   end if;
   reachable:=array_append(reachable,target);
  end loop;
 end loop;
end;
$$;
revoke all on function marketing_private.validate_ai_flow(jsonb) from public,anon,authenticated,service_role;

create or replace function public.marketing_ai_flow_save(p_request uuid,p_org uuid,p_brand uuid,p_id uuid,p_version integer,p_definition jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid; current_version integer; result jsonb; fingerprint text; prior public.marketing_requests;
begin
 if p_brand is null or p_request is null then raise exception 'Choose a Brand and retry.';end if;
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_campaigns.manage');
 fingerprint:=md5(jsonb_build_array('ai_flow_save',p_org,p_brand,p_id,p_version,p_definition)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then
  if prior.actor_employee_id<>actor or prior.fingerprint<>fingerprint then raise exception 'Request already used.';end if;
  return prior.result;
 end if;
 perform marketing_private.validate_ai_flow(p_definition);
 if not exists(select 1 from public.brands where organization_id=p_org and id=p_brand and is_active) then raise exception 'Brand is inactive.';end if;
 if p_id is null then
  if p_version is distinct from 0 then raise exception 'Draft changed. Reload and try again.';end if;
  p_id:=gen_random_uuid();
  current_version:=0;
 else
  perform pg_advisory_xact_lock(hashtextextended('ai_flow:'||p_id::text,0));
  select max(version) into current_version from marketing_private.ai_flow_drafts where id=p_id and organization_id=p_org and brand_id=p_brand;
  if current_version is null then raise exception using errcode='42501',message='Draft unavailable.';end if;
  if current_version is distinct from p_version then raise exception 'Draft changed. Reload and try again.';end if;
 end if;
 insert into marketing_private.ai_flow_drafts(id,version,organization_id,brand_id,definition,actor_id)
 values(p_id,current_version+1,p_org,p_brand,p_definition,actor)
 returning jsonb_build_object('id',id,'version',version,'definition',definition,'created_at',created_at) into result;
 insert into public.marketing_requests values(p_request,actor,fingerprint,result);
 return result;
end;
$$;

create table marketing_private.ai_flow_generation (
 request_id uuid primary key, actor_id uuid not null references public.employees(id),
 organization_id uuid not null,brand_id uuid not null, intent_hash text not null,
 definition jsonb, created_at timestamptz not null default now(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
alter table marketing_private.ai_flow_generation enable row level security;
revoke all on marketing_private.ai_flow_generation from public,anon,authenticated,service_role;
create index ai_flow_generation_quota on marketing_private.ai_flow_generation(actor_id,created_at desc);

create function public.marketing_ai_flow_generate_prepare(p_request uuid,p_org uuid,p_brand uuid,p_description text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; prior marketing_private.ai_flow_generation; fingerprint text;
begin
 if p_request is null or p_brand is null or length(btrim(coalesce(p_description,''))) not between 10 and 1500 then
  raise exception 'Describe the flow in 10–1500 characters.';
 end if;
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.manage');
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.ai');
 if not exists(select 1 from public.brands where id=p_brand and organization_id=p_org and is_active)
 or not exists(select 1 from public.marketing_inbox_policies where brand_id=p_brand and ai_allowed and automation_mode<>'off') then
  raise exception 'Save Brand AI consent before testing.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,2));
 fingerprint:=md5(p_description);
 select * into prior from marketing_private.ai_flow_generation where request_id=p_request;
 if found then
  if (prior.actor_id,prior.organization_id,prior.brand_id,prior.intent_hash) is distinct from (actor,p_org,p_brand,fingerprint) then
   raise exception 'Test request identity changed.';
  end if;
  return jsonb_build_object('state',case when prior.definition is null then 'unavailable' else 'completed' end,'definition',prior.definition);
 end if;
 if (select count(*) from marketing_private.ai_flow_generation where actor_id=actor and created_at>now()-interval '24 hours')>=5
 or exists(select 1 from marketing_private.ai_flow_generation where actor_id=actor and created_at>now()-interval '20 seconds') then
  raise exception 'Flow generation limit reached.';
 end if;
 insert into marketing_private.ai_flow_generation(request_id,actor_id,organization_id,brand_id,intent_hash)
 values(p_request,actor,p_org,p_brand,fingerprint);
 return jsonb_build_object('state','prepared');
end;
$$;

create function public.marketing_ai_flow_generate_finish(p_request uuid,p_definition jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare run marketing_private.ai_flow_generation;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into run from marketing_private.ai_flow_generation where request_id=p_request for update;
 if not found or run.definition is not null or run.created_at<now()-interval '2 minutes'
 or not marketing_private.actor_allowed(run.actor_id,run.organization_id,run.brand_id,'marketing_campaigns.manage')
 or not marketing_private.actor_allowed(run.actor_id,run.organization_id,run.brand_id,'marketing_inbox.ai')
 or not exists(select 1 from public.brands where id=run.brand_id and organization_id=run.organization_id and is_active)
 or not exists(select 1 from public.marketing_inbox_policies where brand_id=run.brand_id and ai_allowed and automation_mode<>'off') then
  raise exception 'Generation authorization changed.';
 end if;
 perform marketing_private.validate_ai_flow(p_definition);
 update marketing_private.ai_flow_generation set definition=p_definition where request_id=p_request;
 return jsonb_build_object('state','completed','definition',p_definition);
end;
$$;
revoke all on function public.marketing_ai_flow_generate_prepare(uuid,uuid,uuid,text),public.marketing_ai_flow_generate_finish(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketing_ai_flow_generate_prepare(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.marketing_ai_flow_generate_finish(uuid,jsonb) to service_role;
