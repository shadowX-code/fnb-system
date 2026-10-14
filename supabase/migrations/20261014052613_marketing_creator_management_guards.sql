-- Forward correction: safe labels and preserved publishing evidence.
create or replace function marketing_private.creator_labels(p_org uuid,p_creator uuid,p_payload jsonb) returns public.marketing_creators
language plpgsql security definer set search_path=public as $$
declare c public.marketing_creators;k text;names text[];original text[];n text;
begin
 perform marketing_private.require_access(p_org,null,'marketing_creators.manage');
 select * into c from public.marketing_creators where id=p_creator and organization_id=p_org for update;
 if not marketing_private.creator_editable(p_org,c.id) then raise exception using errcode='42501',message='Shared profile access changed.';end if;
 foreach k in array array['location','category'] loop
 original:=case when k='location' then c.locations else c.categories end;
 if k='location' and p_payload?'locations' then
 if jsonb_typeof(p_payload->'locations')<>'array' or jsonb_array_length(p_payload->'locations')>20 then raise exception 'Choose up to twenty locations.';end if;
 select coalesce(array_agg(value order by ord),'{}') into names from jsonb_array_elements_text(p_payload->'locations') with ordinality a(value,ord);
 else names:=original;end if;
 for n in select unnest(names) loop
 n:=regexp_replace(trim(n),'\s+',' ','g');if n='' then continue;end if;
 if length(n)>60 and not(n=any(original)) then raise exception 'Option names must be at most sixty characters.';end if;
 if length(n)<=60 then
 insert into public.marketing_creator_options(organization_id,kind,name) values(p_org,k,n) on conflict(organization_id,kind,normalized) do nothing;
 end if;
 end loop;
 select coalesce(array_agg(name order by ord),'{}') into names from (
 select distinct on(lower(regexp_replace(trim(a.value),'\s+',' ','g'))) coalesce(o.name,regexp_replace(trim(a.value),'\s+',' ','g')) name,a.ord
 from unnest(names) with ordinality a(value,ord) left join public.marketing_creator_options o on o.organization_id=p_org and o.kind=k and o.normalized=lower(regexp_replace(trim(a.value),'\s+',' ','g'))
 where trim(a.value)<>'' order by lower(regexp_replace(trim(a.value),'\s+',' ','g')),a.ord)x;
 if k='location' then update public.marketing_creators set locations=names,location=coalesce(names[1],'') where id=c.id returning * into c;
 else update public.marketing_creators set categories=names where id=c.id returning * into c;end if;
 end loop;return c;
end;$$;
do $$
declare body text;needle text;
begin
 body:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 needle:='update public.marketing_creator_deliverables set content_type=';
 if position(needle in body)=0 then raise exception 'Publishing contract changed';end if;
 body:=replace(body,needle,'if exists(select 1 from public.marketing_creator_posts cp where cp.deliverable_id=d.id) and ((nullif(item->>''content_type'','''') is not null and nullif(item->>''content_type'','''') is distinct from d.content_type) or item->>''status''=''cancelled'') then raise exception ''Preserve a publishing entry with linked Posts.'';end if; '||needle);
 needle:='parsed:=marketing_private.creator_url(p_payload->>''url'');';
 body:=replace(body,needle,'if p.collaboration_id is not null then
 perform 1 from public.marketing_creator_collaborations where id=p.collaboration_id for update;
 if exists(select 1 from public.marketing_creator_collaborations where id=p.collaboration_id and status=''published'') and (nullif(p_payload->>''collaboration_id'','''')::uuid is distinct from p.collaboration_id or (nullif(p_payload->>''published_at'','''') is null and nullif(p_payload->>''published_date'','''') is null and p.publication_confirmed_at is null and coalesce((p_payload->>''confirm_published'')::boolean,false)=false)) and not exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=p.collaboration_id and cp.id<>p.id and (cp.published_at is not null or cp.published_date is not null or cp.publication_confirmed_at is not null)) then raise exception ''Change the collaboration status before removing its last published Post evidence.'';end if;end if; '||needle);
 body:=replace(body,'update public.marketing_creator_collaborations set outlet_id=outlet','update public.marketing_creator_collaborations set creator_id=coalesce(v.creator_id,linked_creator),outlet_id=outlet');
 body:=replace(body,'if p_payload?''public_observation'' then
 if jsonb_typeof', 'if p_payload?''public_observation'' then
 if nullif(p_payload->''public_observation''->>''captured_at'','''') is null or (p_payload->''public_observation''->>''captured_at'')::timestamptz>now()+interval ''5 minutes'' then raise exception ''Choose an actual profile observation time.'';end if;
 if jsonb_typeof');
 execute body;
end;$$;
revoke all on function marketing_private.creator_labels(uuid,uuid,jsonb) from public,anon,authenticated;
