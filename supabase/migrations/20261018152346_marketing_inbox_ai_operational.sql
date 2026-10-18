-- Extend the existing context and artifact authorities; no messaging or assignment activation.
alter table public.marketing_conversations add column outlet_context_evidence jsonb not null default '{}';

-- Match only complete canonical names/codes or an unambiguous canonical location within this Brand.
create function marketing_private.inbox_outlet_reference(p_brand uuid,p_text text) returns jsonb
language plpgsql stable set search_path=public as $$
declare o record;term text;terms text[];q text:=lower(regexp_replace(left(coalesce(p_text,''),8000),'[^[:alnum:]一-龥]+',' ','g'));hits uuid[]:='{}';negated boolean:=false;hit boolean;
begin
 for o in select x.id,x.name,x.code,x.location from outlets x join brand_outlets b on b.outlet_id=x.id where b.brand_id=p_brand and x.is_active order by x.id loop
  hit:=false;terms:=array[o.name,case when length(o.code)>=3 then o.code end,case when length(o.location)>=3 then o.location end];
  foreach term in array terms loop
   term:=lower(regexp_replace(coalesce(term,''),'[^[:alnum:]一-龥]+',' ','g'));
   if length(trim(term))<3 then continue;end if;
   if (q ~ ('(^|[^a-z0-9])'||trim(term)||'([^a-z0-9]|$)') or term ~ '[一-龥]' and position(trim(term) in q)>0) then
    if position('not '||trim(term) in q)>0 or position('bukan '||trim(term) in q)>0 or position('不是 '||trim(term) in q)>0 or position('不是'||trim(term) in q)>0 then negated:=true;else hit:=true;end if;
   end if;
  end loop;
  if hit then hits:=array_append(hits,o.id);end if;
 end loop;
 if cardinality(hits)=1 and not negated then return jsonb_build_object('state','matched','outlet_id',hits[1]);end if;
 if cardinality(hits)>1 or negated or q ~ '(other|another|different|which) (branch|outlet)|cawangan (lain|mana)|分店|另一家|换一家' then return jsonb_build_object('state','clarification_required');end if;
 return jsonb_build_object('state','none');
end;$$;

create function marketing_private.inbox_capture_outlet_reference() returns trigger
language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations;r jsonb;target uuid;source text;
begin
 select * into c from marketing_conversations where id=new.conversation_id for update;
 if not(new.kind='incoming' or c.channel='internal' and new.kind='note') then return new;end if;
 if exists(select 1 from marketing_conversation_messages m where m.conversation_id=c.id and (m.kind='incoming' or c.channel='internal' and m.kind='note') and (m.occurred_at,m.id)>(new.occurred_at,new.id)) then return new;end if;
 r:=marketing_private.inbox_outlet_reference(c.brand_id,new.body);
 if r->>'state'='none' then return new;end if;
 target:=nullif(r->>'outlet_id','')::uuid;source:=case when new.kind='note' then 'internal_reference' else 'customer_reference' end;
 update marketing_conversations set outlet_id=target,outlet_context_evidence=jsonb_build_object('source',source,'state',r->>'state','message_id',new.id,'occurred_at',new.occurred_at),version=version+1,updated_at=now() where id=c.id;
 return new;
end;$$;
create trigger inbox_capture_outlet_reference after insert on public.marketing_conversation_messages for each row execute function marketing_private.inbox_capture_outlet_reference();

create function marketing_private.inbox_outlet_context(p_conversation uuid) returns jsonb
language plpgsql stable set search_path=public as $$
declare c public.marketing_conversations;ids uuid[];target uuid;source text;
begin
 select * into c from marketing_conversations where id=p_conversation;
 select array_agg(o.id order by o.id) into ids from outlets o join brand_outlets b on b.outlet_id=o.id where b.brand_id=c.brand_id and o.is_active;
 if c.outlet_id=any(ids) then target:=c.outlet_id;source:=coalesce(c.outlet_context_evidence->>'source','staff_confirmed');
 elsif c.outlet_id is not null then source:='mapping_changed';
 elsif coalesce(c.outlet_context_evidence->>'state','') in ('clarification_required','cleared') then source:='clarification_required';
 elsif cardinality(ids)=1 then target:=ids[1];source:='single_outlet';
 else source:='unknown';end if;
 return jsonb_build_object('outlet_id',target,'source',source,'name',(select name from outlets where id=target),'eligible_count',coalesce(cardinality(ids),0),'known',target is not null);
end;$$;
revoke all on function marketing_private.inbox_outlet_reference(uuid,text),marketing_private.inbox_capture_outlet_reference(),marketing_private.inbox_outlet_context(uuid) from public,anon,authenticated,service_role;

-- Existing explicit confirmation/clear remains the only staff context command.
do $migration$ declare f text;needle text:='update marketing_conversations set outlet_id=target,version=version+1,updated_at=now() where id=c.id returning * into c;';begin
 f:=pg_get_functiondef('public.marketing_inbox_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Outlet context command baseline differs.';end if;
 execute replace(f,needle,'update marketing_conversations set outlet_id=target,outlet_context_evidence=jsonb_build_object(''source'',''staff_confirmed'',''state'',case when target is null then ''cleared'' else ''matched'' end),version=version+1,updated_at=now() where id=c.id returning * into c;');
end;$migration$;

-- Resolve before collecting facts, and use the actual latest customer question, not a later echo.
do $migration$ declare f text;begin
 f:=pg_get_functiondef('marketing_private.inbox_assistant_material(uuid)'::regprocedure);
 if position('direct:=marketing_private.customer_knowledge_facts(c.brand_id,c.outlet_id' in f)=0 then raise exception 'Assistant material baseline differs.';end if;
 f:=replace(f,'source_row record;','source_row record; context jsonb; question text;');
 f:=replace(f,'select * into c from public.marketing_conversations where id=p_conversation;','select * into c from public.marketing_conversations where id=p_conversation; context:=marketing_private.inbox_outlet_context(c.id); c.outlet_id:=nullif(context->>''outlet_id'','''')::uuid; select body into question from marketing_conversation_messages where conversation_id=c.id and (kind=''incoming'' or c.channel=''internal'' and kind=''note'') order by occurred_at desc,id desc limit 1;');
 f:=replace(f,'coalesce((r->''history''->-1)->>''text'','''')','coalesce(question,'''')');
 f:=replace(f,'r:=jsonb_set(r,''{facts}'',coalesce(r->''facts'',''{}'')||direct);','r:=jsonb_set(r,''{facts}'',coalesce(r->''facts'',''{}'')||direct)||jsonb_build_object(''outlet_context'',context);');
 execute f;
end;$migration$;

-- Current/time-specific evidence for today/tomorrow; preserve the entire canonical schedule.
do $migration$ declare f text;needle text:='''local_date'',local_day,''today_hours'',hours';begin
 f:=pg_get_functiondef('marketing_private.customer_knowledge_facts(uuid,uuid,text)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Operational knowledge baseline differs.';end if;
 f:=replace(f,'counted integer;','counted integer; requested_day date; requested_hours jsonb;');
 f:=replace(f,'profile:=row.data||', 'requested_day:=local_day+case when p_question ~* ''day after tomorrow|后天|後天|lusa'' then 2 when p_question ~* ''tomorrow|明天|esok'' then 1 when p_question ~* ''next week|next month|[0-9]{4}-[0-9]{2}-[0-9]{2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|星期|周[一二三四五六日天]|minggu depan|bulan depan'' then null else 0 end; select value into requested_hours from jsonb_array_elements(row.data->''special_hours'') value where value->>''date''=requested_day::text; if requested_hours is null then select value into requested_hours from jsonb_array_elements(row.data->''weekly_hours'') value where (value->>''day'')::int=extract(dow from requested_day)::int;end if; profile:=row.data||');
 f:=replace(f,needle,needle||',''requested_date'',requested_day,''requested_hours'',requested_hours');
 execute f;
end;$migration$;

-- One mutable staff assessment per suggestion/actor, retaining the exact generated source snapshot.
create table public.marketing_inbox_ai_feedback (
 artifact_id uuid not null references public.marketing_inbox_ai_artifacts(id),actor_employee_id uuid not null references public.employees(id),
 helpful boolean not null,reason text check(reason is null or reason in ('incorrect_facts','wrong_outlet','missed_question','language_tone','missing_knowledge','not_relevant','other')),
 source_hash text,sources jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(artifact_id,actor_employee_id)
);
alter table public.marketing_inbox_ai_feedback enable row level security;
revoke all on public.marketing_inbox_ai_feedback from public,anon,authenticated;
create function public.marketing_inbox_feedback(p_artifact uuid,p_helpful boolean,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.marketing_inbox_ai_artifacts;c public.marketing_conversations;actor uuid;result public.marketing_inbox_ai_feedback;
begin
 select * into a from marketing_inbox_ai_artifacts where id=p_artifact;
 select * into c from marketing_conversations where id=a.conversation_id;
 if c.id is null then raise exception 'Suggestion unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.ai');
 if p_helpful is null or p_reason is not null and p_reason not in ('incorrect_facts','wrong_outlet','missed_question','language_tone','missing_knowledge','not_relevant','other') then raise exception 'Choose a valid feedback reason.';end if;
 insert into marketing_inbox_ai_feedback(artifact_id,actor_employee_id,helpful,reason,source_hash,sources)
 values(a.id,actor,p_helpful,case when p_helpful then null else p_reason end,a.body->>'source_hash',coalesce(a.body->'sources','[]'))
 on conflict(artifact_id,actor_employee_id) do update set helpful=excluded.helpful,reason=excluded.reason,updated_at=now() where (marketing_inbox_ai_feedback.helpful,marketing_inbox_ai_feedback.reason) is distinct from (excluded.helpful,excluded.reason);
 select * into result from marketing_inbox_ai_feedback where artifact_id=a.id and actor_employee_id=actor;
 return to_jsonb(result)-'actor_employee_id';
end;$$;
revoke all on function public.marketing_inbox_feedback(uuid,boolean,text) from public,anon;
grant execute on function public.marketing_inbox_feedback(uuid,boolean,text) to authenticated;

-- Source labels must name their actual authority. No extra copy of source facts is stored.
do $migration$ declare f text;needle text:='case when ref ~ ''^(menu|promotion|outlet):'' then ''customer_knowledge'' else ''brand_intelligence'' end';begin
 f:=pg_get_functiondef('public.marketing_inbox_ai_finish(uuid,uuid,jsonb,text,integer,integer,boolean)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Assistant source projection baseline differs.';end if;
 execute replace(f,needle,'case when ref like ''menu:%'' then ''menu'' when ref like ''promotion:%'' then ''promotion'' when ref like ''outlet:%'' then ''outlet'' else ''brand_intelligence'' end');
end;$migration$;
do $migration$ declare f text;needle text:='return jsonb_build_object(''outlet_options''';begin
 f:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Inbox detail baseline differs.';end if;
 execute replace(f,needle,'return jsonb_build_object(''outlet_context'',marketing_private.inbox_outlet_context(c.id),''ai_feedback'',coalesce((select jsonb_agg(to_jsonb(f)-''actor_employee_id'') from marketing_inbox_ai_feedback f join marketing_inbox_ai_artifacts a on a.id=f.artifact_id where a.conversation_id=c.id and f.actor_employee_id=actor),''[]''::jsonb),''outlet_options''');
end;$migration$;

do $migration$ declare f text;needle text:=$needle$'knowledge',r->'knowledge'$needle$;begin
 f:=pg_get_functiondef('public.marketing_faq_settings_read(uuid)'::regprocedure);
 if position(needle in f)=0 then raise exception 'FAQ settings projection differs.';end if;
 execute replace(f,needle,'''knowledge'',coalesce(r->''knowledge'',''{}''::jsonb)||jsonb_build_object(''manager_confirmed'',exists(select 1 from marketing_knowledge k where k.brand_id=p_brand and k.confirmed_revision=k.revision and cardinality(k.confirmed_keys)>0))');
end;$migration$;
