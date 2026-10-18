-- Safe unsaved style preview; no Brand fact publication or new approval lifecycle.
alter table marketing_private.knowledge_ai_runs add column preview jsonb;
drop function public.marketing_knowledge_ai_prepare(uuid,uuid,text,uuid);
create function public.marketing_knowledge_ai_prepare(p_request uuid,p_brand uuid,p_kind text,p_entry uuid default null,p_preview jsonb default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid; person uuid; k public.marketing_customer_knowledge; r marketing_private.knowledge_ai_runs; v integer; fp text;
begin
 select organization_id into org from public.brands where id=p_brand;person:=marketing_private.require_access(org,p_brand,'marketing_settings.manage');
 if p_request is null or coalesce(p_kind,'') not in ('menu','tone') then raise exception 'Choose menu extraction or a tone preview.';end if;
 if not exists(select 1 from public.marketing_inbox_policies where brand_id=p_brand and ai_allowed and automation_mode<>'off') then raise exception 'Enable this Brand’s AI consent in FAQ & AI first.';end if;
 if p_kind='menu' then
  select * into k from public.marketing_customer_knowledge where id=p_entry and brand_id=p_brand and kind='menu';
  if k.id is null or k.state not in ('pending','preview') then raise exception 'Choose an uploaded, unconfirmed menu.';end if;
  if k.state='preview' then return jsonb_build_object('state','completed','result',k.data);end if;
  if not exists(select 1 from storage.objects where bucket_id='marketing-knowledge' and name=k.object_path and (metadata->>'size')::bigint=k.size_bytes) then raise exception 'Upload the menu file first.';end if;
  v:=k.revision;
 else
  select coalesce(max(revision),0) into v from public.marketing_knowledge where brand_id=p_brand;
  if p_preview is not null and (jsonb_typeof(p_preview)<>'object' or octet_length(p_preview::text)>5000 or coalesce(p_preview->>'tone','') not in ('warm','friendly','professional','playful','calm') or coalesce(p_preview->>'formality','') not in ('casual','balanced','formal') or coalesce(p_preview->>'emoji','') not in ('none','light','expressive') or coalesce(p_preview->>'language','') not in ('customer','EN','ZH','BM') or length(coalesce(p_preview->>'guidelines',''))>4000) then raise exception 'Choose valid Tone & Persona settings.';end if;
 end if;
 fp:=encode(extensions.digest(jsonb_build_array(p_brand,p_kind,p_entry,v,p_preview)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_brand::text,52));
 perform pg_advisory_xact_lock(hashtextextended(person::text,51));
 select * into r from marketing_private.knowledge_ai_runs where request_id=p_request;
 if r.request_id is not null then if r.actor<>person or r.fingerprint<>fp then raise exception 'Request identity changed.';end if;return jsonb_build_object('state',r.state,'result',r.result);end if;
 if exists(select 1 from marketing_private.knowledge_ai_runs where brand_id=p_brand and state in ('prepared','claimed') and created_at>now()-interval '2 minutes') then raise exception 'A knowledge AI request is already running. Check again shortly.';end if;
 if (select count(*) from marketing_private.knowledge_ai_runs where actor=person and created_at>now()-interval '24 hours')>=10 then raise exception 'Daily knowledge AI limit reached (10).';end if;
 insert into marketing_private.knowledge_ai_runs(request_id,brand_id,actor,kind,entry_id,fingerprint,source_revision,preview) values(p_request,p_brand,person,p_kind,p_entry,fp,v,case when p_kind='tone' then p_preview end);
 return jsonb_build_object('state','prepared');
end;$$;

create or replace function public.marketing_knowledge_ai_claim(p_request uuid,p_auth_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.knowledge_ai_runs; org uuid; person uuid; k public.marketing_customer_knowledge;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.knowledge_ai_runs where request_id=p_request for update;
 select id into person from public.employees where auth_user_id=p_auth_user;
 select organization_id into org from public.brands where id=r.brand_id;
 if r.state<>'prepared' or r.actor is distinct from person or not marketing_private.actor_allowed(person,org,r.brand_id,'marketing_settings.manage') or not exists(select 1 from public.marketing_inbox_policies where brand_id=r.brand_id and ai_allowed and automation_mode<>'off') then raise exception 'Knowledge AI authority changed.';end if;
 update marketing_private.knowledge_ai_runs set state='claimed',lease=gen_random_uuid() where request_id=p_request returning * into r;
 select * into k from public.marketing_customer_knowledge where id=r.entry_id;
 if r.kind='menu' and (k.id is null or k.state<>'pending' or k.revision<>r.source_revision) or r.kind='tone' and coalesce((select revision from public.marketing_knowledge where brand_id=r.brand_id),0)<>r.source_revision then raise exception 'Knowledge source changed before generation.';end if;
 return jsonb_build_object('lease',r.lease,'kind',r.kind,'entry',to_jsonb(k),'profile',coalesce(case when r.preview is not null then jsonb_build_object('fields',r.preview) end,(select profile->'voice' from public.marketing_knowledge where brand_id=r.brand_id)),'guidelines',coalesce(r.preview->>'guidelines',(select profile->'rules'->>'text' from public.marketing_knowledge where brand_id=r.brand_id)));
end;$$;

create or replace function public.marketing_knowledge_ai_finish(p_request uuid,p_lease uuid,p_result jsonb,p_usage jsonb,p_error text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.knowledge_ai_runs; k public.marketing_customer_knowledge; org uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.knowledge_ai_runs where request_id=p_request and lease=p_lease for update;
 if r.request_id is null then raise exception 'Unknown knowledge request.';end if;
 if r.state<>'claimed' then return jsonb_build_object('state',r.state,'result',r.result);end if;
 if octet_length(coalesce(p_result,'{}')::text)>65536 or octet_length(coalesce(p_usage,'{}')::text)>1000 then raise exception 'Knowledge AI result too large.';end if;
 update marketing_private.knowledge_ai_runs set model=left(p_usage->>'model',100),input_tokens=(p_usage->>'input')::int,output_tokens=(p_usage->>'output')::int,latency_ms=(p_usage->>'latency_ms')::int where request_id=p_request;
 select organization_id into org from public.brands where id=r.brand_id;
 if not marketing_private.actor_allowed(r.actor,org,r.brand_id,'marketing_settings.manage') or not exists(select 1 from public.marketing_inbox_policies where brand_id=r.brand_id and ai_allowed and automation_mode<>'off') then update marketing_private.knowledge_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');end if;
 if p_error is not null then update marketing_private.knowledge_ai_runs set state='failed',failure_reason=left(p_error,80) where request_id=p_request;return jsonb_build_object('state','failed');end if;
 if r.kind='menu' then
  select * into k from public.marketing_customer_knowledge where id=r.entry_id for update;
  if k.revision<>r.source_revision or k.state<>'pending' then update marketing_private.knowledge_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');end if;
  if jsonb_typeof(p_result->'items') is distinct from 'array' or jsonb_array_length(p_result->'items')>100 then raise exception 'Invalid menu extraction.';end if;
  update public.marketing_customer_knowledge set data=p_result,state='preview',revision=revision+1,updated_at=now() where id=k.id;
 elsif coalesce((select revision from public.marketing_knowledge where brand_id=r.brand_id),0)<>r.source_revision then update marketing_private.knowledge_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');
 elsif length(coalesce(p_result->>'text','')) not between 1 and 1000 then raise exception 'Invalid tone preview.';end if;
 update marketing_private.knowledge_ai_runs set state='completed',result=p_result where request_id=p_request;
 return jsonb_build_object('state','completed','result',p_result,'usage',p_usage);
end;$$;

revoke all on function public.marketing_knowledge_ai_prepare(uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.marketing_knowledge_ai_prepare(uuid,uuid,text,uuid,jsonb) to authenticated;
