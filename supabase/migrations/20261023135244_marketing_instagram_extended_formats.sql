-- Extended formats remain behind an independent default-off runtime opt-in.
do $migration$
declare body text;
begin
 body:=pg_get_functiondef('marketing_private.validate_content(uuid,uuid,jsonb,boolean)'::regprocedure);
 if position($old$variant->>'format' in ('image','carousel') and$old$ in body)=0 then raise exception 'Unexpected content media validator';end if;
 body:=replace(body,$old$not in ('text','image','carousel','reel','video')$old$,$new$not in ('text','image','carousel','reel','video','story')$new$);
 body:=replace(body,$old$or (variant->>'channel'='instagram' and$old$,$new$or (variant->>'channel'='facebook' and variant->>'format'='story') or (variant->>'channel'='instagram' and$new$);
 body:=replace(body,$old$variant->>'format' in ('image','carousel') and exists(select 1 from public.marketing_assets where id=media and mime_type not like 'image/%')$old$,$new$(variant->>'format'='image' or variant->>'format'='carousel' and variant->>'channel'='facebook') and exists(select 1 from public.marketing_assets where id=media and mime_type not like 'image/%')
     or variant->>'channel'='instagram' and variant->>'format' in ('carousel','story') and exists(select 1 from public.marketing_assets where id=media and (mime_type not in ('image/jpeg','video/mp4') or size_bytes>case when mime_type='video/mp4' then 52428800 else 8388608 end))$new$);
 body:=replace(body,$old$variant->>'format' in ('image','reel','video')$old$,$new$variant->>'format' in ('image','reel','video','story')$new$);
 execute body;
end;$migration$;

-- The same service-owned diagnostic/credential-generation authority records business-only Story eligibility.
create function public.marketing_meta_record_formats(p_connection uuid,p_auth_user uuid,p_generation integer,p_business boolean)
returns void language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;
begin
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.channel<>'instagram' or c.credential_generation<>p_generation or c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() then raise exception 'Connection authority changed.';end if;
 update public.marketing_connections set capabilities=capabilities||jsonb_build_object('story_business_verified',p_business is true,'formats',case when p_business is true and capabilities->>'publishing'='true' then '["image","carousel","reel","story"]'::jsonb else '["image","carousel","reel"]'::jsonb end) where id=c.id;
end;$$;
revoke all on function public.marketing_meta_record_formats(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.marketing_meta_record_formats(uuid,uuid,integer,boolean) to service_role;

-- Story publications are not Post/Reel target credit. Resolve a completed/cancelled partial plan accurately.
do $migration$
declare p record;body text;
begin
 body:=pg_get_functiondef('marketing_private.creative_publication_counts(uuid,uuid,date)'::regprocedure);
 if position($old$and j.state='succeeded' and j.provider_post_id is not null$old$ in body)=0 then raise exception 'Unexpected publication target authority';end if;
 body:=replace(body,$old$and j.state='succeeded' and j.provider_post_id is not null$old$,$new$and j.state='succeeded' and j.provider_post_id is not null and v.variant->>'format'<>'story'$new$);
 body:=replace(body,$old$r.payload->'variants'->0->>'format'$old$,$new$(select v->>'format' from jsonb_array_elements(r.payload->'variants') v where v->>'format'<>'story' limit 1)$new$);
 body:=replace(body,$old$and c.status='scheduled' and c.approved_revision=c.revision$old$,$new$and c.status='scheduled' and c.approved_revision=c.revision and exists(select 1 from jsonb_array_elements(r.payload->'variants') v where v->>'format'<>'story')$new$);
 execute body;
 body:=pg_get_functiondef('public.marketing_finish_job(uuid,uuid,text,text,text)'::regprocedure);
 if position($old$elsif exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='failed') then$old$ in body)=0 then raise exception 'Unexpected publishing finalization';end if;
 body:=replace(body,$old$elsif exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='failed') then$old$,$new$elsif not exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state not in ('succeeded','cancelled')) then
   update public.marketing_content set status='cancelled',updated_at=now() where id=c.id;
 elsif exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='failed') then$new$);
 execute body;
end;$migration$;
