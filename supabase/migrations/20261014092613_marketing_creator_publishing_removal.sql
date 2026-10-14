-- Remove only the collaboration association; never erase a canonical Post or its evidence.
create function marketing_private.creator_remove_publishing(p_org uuid,p_brand uuid,p_collaboration uuid,p_revision integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');
 c public.marketing_creator_collaborations;p public.marketing_creator_posts;d public.marketing_creator_deliverables;result jsonb;
begin
 -- Match save_post/link_post lock order, and recheck both independent revisions.
 select * into p from public.marketing_creator_posts where id=nullif(p_payload->>'post_id','')::uuid and organization_id=p_org and brand_id=p_brand for update;
 if p.id is null or p.revision is distinct from (p_payload->>'post_revision')::integer or p.collaboration_id is distinct from p_collaboration then
 raise exception using errcode='40001',message='Post changed or is unavailable. Reload before removing its link.';end if;
 select * into c from public.marketing_creator_collaborations where id=p_collaboration and organization_id=p_org and brand_id=p_brand for update;
 if c.id is null or c.revision<>p_revision then raise exception using errcode='40001',message='Collaboration changed or is unavailable. Reload.';end if;
 if c.status='published' and not exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=c.id and cp.id<>p.id and (cp.published_at is not null or cp.published_date is not null or cp.publication_confirmed_at is not null)) then
 raise exception 'Change the collaboration status before removing its last published Post evidence.';end if;
 if p.deliverable_id is not null then
 select * into d from public.marketing_creator_deliverables where id=p.deliverable_id and collaboration_id=c.id for update;
 end if;
 if nullif(p_payload->>'deliverable_id','')::uuid is not null and nullif(p_payload->>'deliverable_id','')::uuid is distinct from d.id then raise exception 'The publishing entry changed. Reload.';end if;
 update public.marketing_creator_posts set collaboration_id=null,deliverable_id=null,revision=revision+1,updated_by=actor,updated_at=now() where id=p.id returning * into p;
 insert into marketing_private.creator_revisions values('post',p.id,p.revision,to_jsonb(p),actor,now());
 if d.id is not null and not exists(select 1 from public.marketing_creator_posts cp where cp.deliverable_id=d.id) then
 update public.marketing_creator_deliverables set status='cancelled',revision=revision+1 where id=d.id;
 end if;
 update public.marketing_creator_collaborations set revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 result:=to_jsonb(c)||jsonb_build_object('deliverables',(select coalesce(jsonb_agg(to_jsonb(dd) order by dd.id),'[]') from public.marketing_creator_deliverables dd where dd.collaboration_id=c.id),'removed_post_id',p.id);
 return result;
end;$$;
revoke all on function marketing_private.creator_remove_publishing(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;

do $$
declare body text;needle text;
begin
 body:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 needle:='''link_post'',''save_collaboration''';
 if strpos(body,needle)=0 then raise exception 'Creator command action guard changed.';end if;
 body:=replace(body,needle,'''link_post'',''remove_publishing'',''save_collaboration''');
 needle:='elsif p_action=''link_post'' then';
 if strpos(body,needle)=0 then raise exception 'Creator command dispatch changed.';end if;
 body:=replace(body,needle,'elsif p_action=''remove_publishing'' then result:=marketing_private.creator_remove_publishing(p_org,p_brand,p_id,p_revision,p_payload);entity:=''collaboration'';record_id:=p_id;rev:=(result->>''revision'')::integer; '||needle);
 -- A new Post must serialize with removal/cancellation of its chosen entry.
 needle:='if v.id is null then raise exception ''Choose a same-brand collaboration for this creator.'';end if;end if;';
 if strpos(body,needle)=0 then raise exception 'Post collaboration validation changed.';end if;
 body:=replace(body,needle,'if v.id is null then raise exception ''Choose a same-brand collaboration for this creator.'';end if; perform 1 from public.marketing_creator_collaborations where id=v.id for update;end if;');
 execute body;
end;$$;
