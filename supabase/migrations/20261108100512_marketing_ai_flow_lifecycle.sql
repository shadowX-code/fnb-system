create table marketing_private.ai_flow_lifecycle (
 flow_id uuid primary key, active_version integer, paused boolean not null default true,
 actor_id uuid not null references public.employees(id), updated_at timestamptz not null default now(),
 foreign key(flow_id,active_version) references marketing_private.ai_flow_drafts(id,version),
 check(paused or active_version is not null)
);
create table marketing_private.ai_flow_simulations (
 flow_id uuid not null, version integer not null, actor_id uuid not null references public.employees(id),
 completed_at timestamptz not null default now(),
 primary key(flow_id,version),
 foreign key(flow_id,version) references marketing_private.ai_flow_drafts(id,version)
);
create table marketing_private.ai_flow_lifecycle_events (
 id bigint generated always as identity primary key,
 flow_id uuid not null, version integer not null, action text not null check(action in ('activate','pause','rollback')),
 actor_id uuid not null references public.employees(id), created_at timestamptz not null default now(),
 foreign key(flow_id,version) references marketing_private.ai_flow_drafts(id,version)
);
alter table marketing_private.ai_flow_lifecycle_events enable row level security;
revoke all on marketing_private.ai_flow_lifecycle_events from public,anon,authenticated,service_role;

alter table marketing_private.ai_flow_lifecycle enable row level security;
alter table marketing_private.ai_flow_simulations enable row level security;
revoke all on marketing_private.ai_flow_lifecycle,marketing_private.ai_flow_simulations from public,anon,authenticated,service_role;

create or replace function public.marketing_ai_flow_drafts(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_brand is null then raise exception 'Choose a Brand.';end if;
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 return (select coalesce(jsonb_agg(to_jsonb(rows_) order by rows_.created_at desc),'[]')
 from (select distinct on(d.id) d.id,d.version,d.definition,d.created_at,
       l.active_version,coalesce(l.paused,true) paused,
       exists(select 1 from marketing_private.ai_flow_simulations s where s.flow_id=d.id and s.version=d.version) ready
       from marketing_private.ai_flow_drafts d left join marketing_private.ai_flow_lifecycle l on l.flow_id=d.id
       where d.organization_id=p_org and d.brand_id=p_brand order by d.id,d.version desc) rows_);
end;
$$;

create function public.marketing_ai_flow_versions(p_org uuid,p_brand uuid,p_flow uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_brand is null then raise exception 'Choose a Brand.';end if;
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 return (select coalesce(jsonb_agg(jsonb_build_object('version',d.version,'created_at',d.created_at,'definition',d.definition,
  'ready',exists(select 1 from marketing_private.ai_flow_simulations s where s.flow_id=d.id and s.version=d.version)) order by d.version desc),'[]')
 from marketing_private.ai_flow_drafts d where d.id=p_flow and d.organization_id=p_org and d.brand_id=p_brand);
end;
$$;

-- Replay the path on the stored definition. Browser success flags never confer readiness.
create function public.marketing_ai_flow_certify(p_org uuid,p_brand uuid,p_flow uuid,p_version integer,p_inputs jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; d jsonb; node jsonb; step text:='trigger'; fields jsonb:='{}'; answer text; cursor_ integer:=0;
begin
 if p_brand is null or jsonb_typeof(p_inputs) is distinct from 'array' then raise exception 'Invalid simulation.';end if;
 if jsonb_array_length(p_inputs)>40 or octet_length(p_inputs::text)>24000 then raise exception 'Simulation exceeds the step limit.';end if;
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_campaigns.manage');
 select definition into d from marketing_private.ai_flow_drafts where id=p_flow and version=p_version and organization_id=p_org and brand_id=p_brand;
 if d is null then raise exception 'Draft unavailable.';end if;
 for i in 1..jsonb_array_length(d->'nodes') loop
  select value into node from jsonb_array_elements(d->'nodes') where value->>'id'=step;
  case node->>'type'
   when 'knowledge' then raise exception 'Knowledge paths require verified test evidence before activation.';
   when 'end','handoff' then
    if cursor_<>jsonb_array_length(p_inputs) then raise exception 'Simulation has unused answers.';end if;
    insert into marketing_private.ai_flow_simulations values(p_flow,p_version,actor,now()) on conflict do nothing;
    return;
   when 'ask' then
    if jsonb_typeof(p_inputs->cursor_) is distinct from 'string' then raise exception 'A simulated answer is missing.';end if;
    answer:=btrim(p_inputs->>cursor_);cursor_:=cursor_+1;
    if length(answer) not between 1 and 500 then raise exception 'A simulated answer is invalid.';end if;
    if answer='-' and node->>'required'='false' then answer:='';
    elsif (node->>'value_type'='number' and answer!~'^-?[0-9]+(\.[0-9]+)?$')
      or (node->>'value_type'='boolean' and lower(answer) not in ('yes','no')) then raise exception 'A simulated answer has the wrong type.';end if;
    fields:=fields||jsonb_build_object(node->>'field',answer);step:=node->>'next';
   when 'condition' then
    step:=node->>case when lower(coalesce(fields->>(node->>'field'),''))=lower(node->>'equals') then 'yes' else 'no' end;
   else step:=node->>'next';
  end case;
 end loop;
 raise exception 'Simulation did not reach a terminal step.';
end;
$$;

create function public.marketing_ai_flow_state(p_org uuid,p_brand uuid,p_flow uuid,p_version integer,p_action text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; latest integer;
begin
 if p_brand is null or p_flow is null or p_version is null or coalesce(p_action,'') not in ('activate','pause','rollback') then raise exception 'Invalid flow action.';end if;
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_campaigns.execute');
 perform pg_advisory_xact_lock(hashtextextended('ai_flow:'||p_flow::text,0));
 select max(version) into latest from marketing_private.ai_flow_drafts where id=p_flow and organization_id=p_org and brand_id=p_brand;
 if latest is null then raise exception 'Flow unavailable.';end if;
 if p_action='pause' then
  update marketing_private.ai_flow_lifecycle set paused=true,actor_id=actor,updated_at=now()
   where flow_id=p_flow and active_version=p_version and not paused;
  if not found then raise exception 'Active version changed. Refresh and try again.';end if;
  insert into marketing_private.ai_flow_lifecycle_events(flow_id,version,action,actor_id) values(p_flow,p_version,p_action,actor);
  return;
 end if;
 if (p_action='activate' and latest<>p_version) or not exists(
  select 1 from marketing_private.ai_flow_simulations where flow_id=p_flow and version=p_version
 ) then raise exception 'Run a successful simulation of the selected version first.';end if;
 if not exists(select 1 from public.brands where id=p_brand and organization_id=p_org and is_active) then raise exception 'Brand is inactive.';end if;
 insert into marketing_private.ai_flow_lifecycle values(p_flow,p_version,false,actor,now())
 on conflict(flow_id) do update set active_version=excluded.active_version,paused=false,actor_id=excluded.actor_id,updated_at=excluded.updated_at
 where ai_flow_lifecycle.active_version is distinct from excluded.active_version or ai_flow_lifecycle.paused;
 if found then
  insert into marketing_private.ai_flow_lifecycle_events(flow_id,version,action,actor_id) values(p_flow,p_version,p_action,actor);
 end if;
end;
$$;

revoke all on function public.marketing_ai_flow_versions(uuid,uuid,uuid),public.marketing_ai_flow_certify(uuid,uuid,uuid,integer,jsonb),
 public.marketing_ai_flow_state(uuid,uuid,uuid,integer,text) from public,anon;
grant execute on function public.marketing_ai_flow_versions(uuid,uuid,uuid),public.marketing_ai_flow_certify(uuid,uuid,uuid,integer,jsonb),
 public.marketing_ai_flow_state(uuid,uuid,uuid,integer,text) to authenticated;
