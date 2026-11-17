-- Extend the existing configuration contract; connection never grants human access.
alter table feedx_integrations.native_assistant_config add column ai_action_authorizations jsonb not null default '{}' check(jsonb_typeof(ai_action_authorizations)='object');
do $$
declare d text:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure); old text:=$x$p_payload->>'operation' is distinct from 'read_factory_finished_goods'$x$;
begin
 if strpos(d,old)=0 then raise exception 'capability_configuration_contract_changed';end if;
 d:=replace(d,old,$x$coalesce(p_payload->>'operation','') not in ('read_factory_finished_goods','read_factory_cleaning_methods','read_employee_assignment','read_crew_leave','read_operational_financials','read_marketing_plan','prepare_marketing_draft')$x$);
 execute d;
end $$;
-- Preserve prior connection choice; new READs are explicitly registered and enabled
-- for existing human permissions only. ACTION remains disconnected and unauthorized.
update feedx_integrations.native_assistant_config set capability_connections= jsonb_build_object(
 'read_factory_cleaning_methods',true,'read_employee_assignment',true,'read_crew_leave',true,'read_operational_financials',true,'read_marketing_plan',true) || capability_connections,
 revision=revision+1,updated_at=now();

create table feedx_integrations.native_assistant_action_intents(
 id uuid primary key default gen_random_uuid(), actor uuid not null references auth.users(id),
 session_id uuid not null references feedx_integrations.native_assistant_sessions(id) on delete cascade,
 operation text not null check(operation='prepare_marketing_draft'),version integer not null default 1,
 arguments jsonb not null, fingerprint text not null, state text not null default 'preview' check(state in('preview','cancelled','executed')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',
 confirmed_at timestamptz,result jsonb,unique(actor,session_id,fingerprint)
);
alter table feedx_integrations.native_assistant_action_intents enable row level security;
revoke all on feedx_integrations.native_assistant_action_intents from public,anon,authenticated;

-- Direct human-JWT entry, never an external machine identity. Only an explicit
-- confirmation request can execute. Domain command runs in the same transaction.
create function public.native_assistant_action(p_step text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); c feedx_integrations.native_assistant_config; i feedx_integrations.native_assistant_action_intents;
 a jsonb; fp text; sid uuid; result jsonb; org uuid; brand uuid;
begin
 if actor is null or public.current_user_role_id() is null then raise exception using errcode='42501',message='admin_required';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8000 then raise exception 'invalid_request';end if;
 if p_step='policy' then
  if not public.current_user_has_permission('roles.view') or not public.current_user_has_permission('roles.edit') then raise exception using errcode='42501',message='settings_edit_required';end if;
  select * into c from feedx_integrations.native_assistant_config where singleton for update;
  if c.revision is distinct from (p_payload->>'expected_revision')::bigint then raise exception 'configuration_changed';end if;
  if p_payload->>'operation' is distinct from 'prepare_marketing_draft' or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'configuration_invalid';end if;
  update feedx_integrations.native_assistant_config set ai_action_authorizations=jsonb_set(ai_action_authorizations,'{prepare_marketing_draft}',p_payload->'enabled'),revision=revision+1,updated_by=actor,updated_at=now() where singleton;
  return jsonb_build_object('saved',true);
 end if;
 if p_step='list' then
  sid:=(p_payload->>'session_id')::uuid;
  if not exists(select 1 from feedx_integrations.native_assistant_sessions s where s.id=sid and s.user_id=actor and s.deleted_at is null) then raise exception using errcode='42501',message='session_unavailable';end if;
  return jsonb_build_object('intents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from (select id,operation,arguments,fingerprint,state,expires_at,created_at,result from feedx_integrations.native_assistant_action_intents where actor=native_assistant_action.actor and session_id=sid order by created_at desc limit 20)x));
 end if;
 if p_step not in ('preview','confirm','cancel') then raise exception 'invalid_request';end if;
 if p_step in ('confirm','cancel') then
  select * into i from feedx_integrations.native_assistant_action_intents t where t.id=(p_payload->>'intent_id')::uuid and t.actor=actor for update;
  if not found then raise exception using errcode='42501',message='action_unavailable';end if;
  a:=i.arguments;sid:=i.session_id;
 else
  if p_payload->>'operation' is distinct from 'prepare_marketing_draft' then raise exception 'action_unavailable';end if;
  a:=p_payload->'arguments';sid:=(p_payload->>'session_id')::uuid;
 end if;
 if not exists(select 1 from feedx_integrations.native_assistant_sessions s where s.id=sid and s.user_id=actor and s.deleted_at is null) then raise exception using errcode='42501',message='session_unavailable';end if;
 if p_step='cancel' then
  if i.state='executed' then raise exception 'action_already_executed';end if;
  update feedx_integrations.native_assistant_action_intents set state='cancelled' where id=i.id;return jsonb_build_object('state','cancelled');
 end if;
 -- Lock config through domain commit so disconnect/revocation cannot race execution.
 select * into c from feedx_integrations.native_assistant_config where singleton for share;
 if c.enabled is distinct from true or c.capability_connections->'prepare_marketing_draft' is distinct from 'true'::jsonb or c.ai_action_authorizations->'prepare_marketing_draft' is distinct from 'true'::jsonb then raise exception using errcode='42501',message='action_not_authorized';end if;
 if jsonb_typeof(a) is distinct from 'object' or not a ?& array['organization_id','brand_id','title','caption'] or (a-array['organization_id','brand_id','title','caption'])<>'{}'::jsonb or jsonb_typeof(a->'title') is distinct from 'string' or jsonb_typeof(a->'caption') is distinct from 'string' or length(trim(a->>'title')) not between 1 and 200 or length(a->>'caption')>2000 then raise exception 'invalid_request';end if;
 org:=(a->>'organization_id')::uuid;brand:=(a->>'brand_id')::uuid;
 perform marketing_private.require_access(org,brand,'marketing_content.create');
 fp:=md5(jsonb_build_array('prepare_marketing_draft',1,actor,sid,a)::text);
 if p_step='preview' then
  if (select count(*) from feedx_integrations.native_assistant_action_intents t where t.actor=actor and t.created_at>now()-interval '1 hour')>=20 then raise exception 'action_request_limit';end if;
  insert into feedx_integrations.native_assistant_action_intents(actor,session_id,operation,arguments,fingerprint) values(actor,sid,'prepare_marketing_draft',a,fp)
  on conflict(actor,session_id,fingerprint) do nothing returning * into i;
  if i.id is null then select * into i from feedx_integrations.native_assistant_action_intents t where t.actor=actor and t.session_id=sid and t.fingerprint=fp;end if;
  return jsonb_build_object('intent_id',i.id,'state',i.state,'expires_at',i.expires_at,'preview',a,'confirmation_required',true);
 end if;
 if i.fingerprint is distinct from fp or p_payload->>'fingerprint' is distinct from fp then raise exception 'action_changed';end if;
 if i.state='executed' then return jsonb_build_object('state','executed','replayed',true,'result',i.result);end if;
 if i.state<>'preview' or i.expires_at<=now() then raise exception 'action_expired_or_cancelled';end if;
 result:=public.marketing_content_command(i.id,'save',org,brand,null,0,jsonb_build_object('title',a->>'title','outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel','facebook','format','text','caption',a->>'caption','asset_ids','[]'::jsonb))));
 update feedx_integrations.native_assistant_action_intents set state='executed',confirmed_at=now(),result=result where id=i.id;
 return jsonb_build_object('state','executed','result',result);
end $$;
revoke all on function public.native_assistant_action(text,jsonb) from public,anon;
grant execute on function public.native_assistant_action(text,jsonb) to authenticated;

-- Voice can read several modules in one logical turn. Preserve earlier evidence.
create function feedx_integrations.assistant_merge_evidence(previous jsonb,incoming jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare items jsonb; result jsonb;
begin
 if incoming is null then return previous;end if;
 if previous is null or previous=incoming then return incoming;end if;
 items:=case when previous->>'capability'='business_evidence' then previous->'items' else jsonb_build_array(previous) end;
 if items @> jsonb_build_array(incoming) then return previous;end if;
 if jsonb_array_length(items)>=4 then raise exception 'business_result_limit';end if;
 result:=jsonb_build_object('capability','business_evidence','items',items||jsonb_build_array(incoming));
 if octet_length(result::text)>16000 then raise exception 'business_result_limit';end if;
 return result;
end $$;
revoke all on function feedx_integrations.assistant_merge_evidence(jsonb,jsonb) from public,anon,authenticated;
do $$
declare d text:=pg_get_functiondef('public.native_assistant_voice_history(uuid,jsonb)'::regprocedure);
begin
 if strpos(d,$x$evidence=p_payload->'evidence'$x$)=0 then raise exception 'voice_evidence_contract_changed';end if;
 execute replace(d,$x$evidence=p_payload->'evidence'$x$,$x$evidence=feedx_integrations.assistant_merge_evidence(evidence,p_payload->'evidence')$x$);
end $$;
