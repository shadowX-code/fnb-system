-- Anonymous public inspections share canonical Creator permission and per-member Brand scope.
create table marketing_private.creator_inspection_meter(
 actor uuid primary key references public.employees(id),organization_id uuid not null references public.organizations(id),
 day date not null default current_date,requests integer not null default 0,
 lease uuid,lease_until timestamptz
);
alter table marketing_private.creator_inspection_meter enable row level security;
revoke all on marketing_private.creator_inspection_meter from public,anon,authenticated;
create function public.marketing_creator_inspection_access(p_org uuid,p_brand uuid,p_begin boolean default true,p_lease uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_creators.view');v marketing_private.creator_inspection_meter;
begin
 if p_brand is null then raise exception 'Choose a Brand.';end if;
 perform pg_advisory_xact_lock(hashtextextended('creator-inspect:'||p_org,0));
 if not p_begin then
  update marketing_private.creator_inspection_meter set lease=null,lease_until=null where creator_inspection_meter.actor=actor and organization_id=p_org and lease=p_lease;
  return null;
 end if;
 select * into v from marketing_private.creator_inspection_meter where creator_inspection_meter.actor=actor for update;
 if v.lease_until>clock_timestamp() then raise exception 'A post is already being inspected. Wait a moment.';end if;
 if (v.day=current_date and v.requests>=30) or (select coalesce(sum(requests),0) from marketing_private.creator_inspection_meter where organization_id=p_org and day=current_date)>=100 then raise exception 'Daily inspection limit reached. Manual entry remains available.';end if;
 insert into marketing_private.creator_inspection_meter(actor,organization_id,day,requests,lease,lease_until)
 values(actor,p_org,current_date,1,gen_random_uuid(),clock_timestamp()+interval '1 minute')
 on conflict on constraint creator_inspection_meter_pkey do update set organization_id=p_org,day=current_date,requests=case when creator_inspection_meter.day=current_date then creator_inspection_meter.requests+1 else 1 end,lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute'
 returning * into v;return v.lease;
end;$$;
revoke all on function public.marketing_creator_inspection_access(uuid,uuid,boolean,uuid) from public,anon;
grant execute on function public.marketing_creator_inspection_access(uuid,uuid,boolean,uuid) to authenticated;

-- Keep date-only public evidence date-only; never manufacture a time or timezone.
alter table public.marketing_creator_posts add column published_date date,add column public_observation jsonb;
create function marketing_private.creator_confirm_public(p_post uuid,p_org uuid,p_brand uuid,p_payload jsonb) returns public.marketing_creator_posts
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');p public.marketing_creator_posts;o jsonb:=p_payload->'public_observation';u text;m jsonb;
begin
 select * into p from public.marketing_creator_posts where id=p_post and organization_id=p_org and brand_id=p_brand for update;
 if p.id is null then raise exception 'Post unavailable.';end if;
 if p_payload?'published_date' then update public.marketing_creator_posts set published_date=nullif(p_payload->>'published_date','')::date where id=p.id;end if;
 if o is not null and o<>'null'::jsonb then
  if jsonb_typeof(o)<>'object' or octet_length(o::text)>20000 or o->>'platform'<>p.platform or nullif(o->>'captured_at','') is null
  or (o->>'captured_at')::timestamptz>now()+interval '5 minutes' or (o->>'captured_at')::timestamptz<now()-interval '1 day' then raise exception 'Inspection expired. Inspect the post again.';end if;
  u:=o->>'thumbnail_url';
  if u is not null and (length(u)>3000 or u !~ '^https://([a-zA-Z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net|xhscdn\.com|xiaohongshu\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktok\.com|tiktokv\.com|ibytedtos\.com|byteoversea\.com)/[^[:space:]\\]*$') then raise exception 'Unsupported public thumbnail.';end if;
  m:=coalesce(o->'metrics','{}');
  if jsonb_typeof(m)<>'object' or exists(select 1 from jsonb_each(m) x where x.key not in ('views','likes','comments','shares','saves','interactions','reach') or jsonb_typeof(x.value)<>'number' or (x.value::text)::numeric<0 or (x.value::text)::numeric>1000000000000000) then raise exception 'Use available non-negative metrics only.';end if;
  -- Public observations are staff-confirmed, not provider-verified ownership or OAuth-derived data.
  update public.marketing_creator_posts set metadata_source='public_staff_confirmed',public_observation=jsonb_build_object(
   'source','public_staff_confirmed','captured_at',o->'captured_at','post_id',left(o->>'post_id',150),
   'author_handle',left(o->>'author_handle',100),'author_display_name',left(o->>'author_display_name',200),
   'author_profile_url',left(o->>'author_profile_url',1000),'author_external_id',left(o->>'author_external_id',100),
   'thumbnail_url',u,'date_precision',o->'date_precision','provenance',o->'provenance','unavailable',o->'unavailable',
   'confirmed_by',actor,'confirmed_at',now()) where id=p.id;
  if m<>'{}' then
   insert into public.marketing_creator_metric_snapshots(post_id,metrics,source,source_note,captured_at,recorded_by,request_id)
   values(p.id,m,'manual','Public post observation, reviewed and confirmed by staff; source: '||left(p.canonical_url,350),(o->>'captured_at')::timestamptz,actor,gen_random_uuid());
  end if;
 end if;
 select * into p from public.marketing_creator_posts where id=p.id;return p;
end;$$;
revoke all on function marketing_private.creator_confirm_public(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
do $$declare body text;needle text:='end if;result:=to_jsonb(p);entity:=''post'';record_id:=p.id;rev:=p.revision;';begin
 body:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 if position(needle in body)=0 then raise exception 'Creator command contract changed.';end if;
 body:=replace(body,needle,'end if;p:=marketing_private.creator_confirm_public(p.id,p_org,p_brand,p_payload);result:=to_jsonb(p);entity:=''post'';record_id:=p.id;rev:=p.revision;');
 execute body;
end;$$;
