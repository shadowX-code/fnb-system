-- Derive live lifecycle from canonical publishing entries; preserve stored legacy status and revisions.
create index if not exists marketing_creator_posts_collaboration_lookup on public.marketing_creator_posts(collaboration_id,deliverable_id) where collaboration_id is not null;
create function marketing_private.creator_collaboration_lifecycle(c jsonb) returns jsonb
language sql stable set search_path=public as $$
 with plans as (
 select d.id from public.marketing_creator_deliverables d where d.collaboration_id=(c->>'id')::uuid and d.status<>'cancelled'
 ), posts as (
 select p.*, nullif(p.canonical_url,'') is not null and (p.published_at is not null or p.published_date is not null or p.publication_confirmed_at is not null) confirmed
 from public.marketing_creator_posts p where p.collaboration_id=(c->>'id')::uuid and p.organization_id=(c->>'organization_id')::uuid and p.brand_id=(c->>'brand_id')::uuid
 ), entries as (
 select coalesce(p.confirmed,false) confirmed from plans d left join posts p on p.deliverable_id=d.id
 union all select p.confirmed from posts p where not exists(select 1 from plans d where d.id=p.deliverable_id)
 ), progress as (select count(*) total,count(*) filter(where confirmed) published from entries)
 select c||jsonb_build_object('workflow_status',c->>'status','status',case
 when c->>'status'='cancelled' then 'cancelled'
 when total>0 and total=published then 'published'
 when published>0 or c->>'status' in ('completed','published','in_progress','awaiting_posts') then 'in_progress'
 else 'planned' end) from progress
$$;
revoke all on function marketing_private.creator_collaboration_lifecycle(jsonb) from public,anon,authenticated;

do $patch$
declare body text;needle text;
begin
 select pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into body;
 needle:='if p_payload->>''status''=''published'' and not exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=v.id and cp.brand_id=p_brand and (cp.published_at is not null or cp.published_date is not null or cp.publication_confirmed_at is not null)) then raise exception ''Published requires a confirmed linked published Post URL.'';end if;';
 if position(needle in body)=0 then raise exception 'Missing Collaboration status validation anchor';end if;
 body:=replace(body,needle,'if coalesce(p_payload->>''status'',''planned'') not in (''planned'',''in_progress'') and not (v.id is not null and p_payload->>''status''=v.status and v.status in (''completed'',''published'',''cancelled'',''awaiting_posts'')) then raise exception ''Choose Planned or In Progress. Published is determined by confirmed publishing entries.'';end if;');
 needle:='insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details)';
 if position(needle in body)=0 then raise exception 'Missing command result anchor';end if;
 body:=replace(body,needle,'if entity=''collaboration'' then result:=marketing_private.creator_collaboration_lifecycle(result);end if; '||needle);
 execute body;
 select pg_get_functiondef('marketing_private.creators_workspace(uuid,uuid,boolean)'::regprocedure) into body;
 needle:='jsonb_agg(to_jsonb(v)||jsonb_build_object(''deliverables''';
 if position(needle in body)=0 then raise exception 'Missing workspace Collaboration anchor';end if;
 body:=replace(body,needle,'jsonb_agg(marketing_private.creator_collaboration_lifecycle(to_jsonb(v))||jsonb_build_object(''deliverables''');
 execute body;
 select pg_get_functiondef('marketing_private.creator_remove_publishing(uuid,uuid,uuid,integer,jsonb)'::regprocedure) into body;
 needle:='if c.status=''published'' and not exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=c.id and cp.id<>p.id and (cp.published_at is not null or cp.published_date is not null or cp.publication_confirmed_at is not null)) then
 raise exception ''Change the collaboration status before removing its last published Post evidence.'';end if;';
 if position(needle in body)=0 then raise exception 'Missing last-Post guard anchor';end if;
 execute replace(body,needle,'-- Removing evidence recalculates live lifecycle; canonical Post/history remain.');
end;$patch$;

