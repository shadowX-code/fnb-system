-- Manual confirmation is distinct from provider evidence and never alters receipts.
alter table marketing_private.publication_availability
 add column manual_revision integer not null default 0 check(manual_revision>=0),
 add column manual_removed_at timestamptz,
 add column manual_removed_by uuid references public.employees(id),
 add column manual_cleared_at timestamptz,
 add column manual_sync_lease uuid,
 add column last_object_available_at timestamptz;

create or replace function marketing_private.publication_availability_projection(p_connection uuid,p_generation integer,p_account text,p_post text) returns jsonb
language sql stable security definer set search_path=public as $$
 with scoped as materialized (
  select * from marketing_private.publication_availability where connection_id=p_connection and provider_post_id=p_post
   and (connection_generation=p_generation or p_account is not null and provider_account_id=p_account)
 ), provider as (select * from scoped order by checked_at desc nulls last,connection_generation desc limit 1),
 manual as (select * from scoped where manual_revision>0 order by manual_revision desc limit 1),
 evidence as (
 select p.state,p.source,p.reason,p.checked_at,p.last_available_at,p.last_attempt_at,
  m.manual_revision,m.manual_removed_at,m.manual_removed_by,m.manual_cleared_at,
  coalesce(m.manual_removed_at>coalesce(m.manual_cleared_at,'-infinity'),false) active,
  coalesce((select max(last_object_available_at) from scoped)>m.manual_removed_at,false) recovered
 from (select 1) seed left join provider p on true left join manual m on true
 )
 select jsonb_build_object(
  'state',case when active and not recovered and coalesce(state,'unknown')<>'deleted' then 'manually_removed' else coalesce(state,'unknown') end,
  'provider_state',coalesce(state,'unknown'),'source',coalesce(source,'not_checked'),'reason',coalesce(reason,'not_checked'),
  'checked_at',checked_at,'last_available_at',last_available_at,'last_attempt_at',last_attempt_at,
  'manual_revision',coalesce(manual_revision,0),
  'manual_confirmation',case when manual_revision>0 then jsonb_build_object(
    'state',case when not active then 'cleared' when recovered then 'conflict' else 'confirmed' end,
    'at',manual_removed_at,'actor',manual_removed_by,
    'actor_name',(select coalesce(nullif(trim(nickname),''),full_name) from public.employees where id=manual_removed_by),
    'cleared_at',manual_cleared_at,'source','staff_confirmation') end)
 from evidence;
$$;

create function marketing_private.publication_fully_removed(p_channels jsonb) returns boolean
language sql immutable set search_path=public as $$
 select coalesce(jsonb_array_length(p_channels)>0 and (
  select bool_and(v->>'status'='published' and v->>'provider_post_id' is not null
   and coalesce(v->'availability'->>'state','unknown') in ('deleted','manually_removed')) from jsonb_array_elements(p_channels) v
 ),false);
$$;
revoke all on function marketing_private.publication_fully_removed(jsonb) from public,anon,authenticated;

create function public.marketing_publication_availability_command(p_request uuid,p_connection uuid,p_post text,p_expected_revision integer,p_command text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;actor uuid; prior public.marketing_requests; fp text; projection jsonb; result jsonb;rev integer;
begin
 if p_request is null or p_command is null or p_command not in ('mark_removed','clear_manual') or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid availability confirmation.';end if;
 select * into c from public.marketing_connections where id=p_connection for update;
 if not found then raise exception using errcode='42501',message='Publication unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.publish');
 perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.view');
 if not marketing_private.publication_known(c.id,c.credential_generation,p_post) then raise exception using errcode='42501',message='Publication unavailable for this account.';end if;
 fp:=md5(jsonb_build_array(p_connection,p_post,p_expected_revision,p_command)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then
  if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed. Reopen the post before confirming.';end if;
  return prior.result;
 end if;
 projection:=marketing_private.publication_availability_projection(c.id,c.credential_generation,c.provider_account_id,p_post);
 rev:=(projection->>'manual_revision')::integer;
 if rev<>p_expected_revision then raise exception 'Availability changed. Close and reopen the post before confirming.';end if;
 if p_command='mark_removed' and projection->>'state'='deleted' then raise exception 'Meta has already confirmed this removal.';end if;
 if p_command='clear_manual' and coalesce(projection->'manual_confirmation'->>'state','cleared')='cleared' then raise exception 'No manual confirmation to clear.';end if;
 insert into marketing_private.publication_availability(connection_id,connection_generation,provider_account_id,provider_post_id)
 values(c.id,c.credential_generation,c.provider_account_id,p_post) on conflict do nothing;
 update marketing_private.publication_availability set manual_revision=rev+1,
  manual_removed_at=case when p_command='mark_removed' then clock_timestamp() else (projection->'manual_confirmation'->>'at')::timestamptz end,
  manual_removed_by=case when p_command='mark_removed' then actor else (projection->'manual_confirmation'->>'actor')::uuid end,
  manual_sync_lease=case when p_command='mark_removed' then c.sync_lease else manual_sync_lease end,
  manual_cleared_at=case when p_command='clear_manual' then clock_timestamp() else null end
 where connection_id=c.id and connection_generation=c.credential_generation and provider_post_id=p_post;
 result:=marketing_private.publication_availability_projection(c.id,c.credential_generation,c.provider_account_id,p_post);
 insert into public.marketing_events(organization_id,brand_id,actor_employee_id,action,details)
 values(c.organization_id,c.brand_id,actor,'publishing.'||p_command,
 jsonb_build_object('connection_id',c.id,'generation',c.credential_generation,'provider_post_id',p_post,'source','staff_confirmation','manual_revision',rev+1,'request_id',p_request,'at',clock_timestamp()));
 insert into public.marketing_requests(request_id,actor_employee_id,fingerprint,result) values(p_request,actor,fp,result);
 return result;
end;$$;
revoke all on function public.marketing_publication_availability_command(uuid,uuid,text,integer,text) from public,anon;
grant execute on function public.marketing_publication_availability_command(uuid,uuid,text,integer,text) to authenticated;


create or replace function marketing_private.record_publication_availability(p_connection uuid,p_generation integer,p_lease uuid,p_observations jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;o jsonb;a marketing_private.publication_availability;next_state text;next_reason text;next_source text;observed_time timestamptz;can_restore boolean;
begin
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 if jsonb_typeof(p_observations) is distinct from 'array' or jsonb_array_length(p_observations)>8 or octet_length(p_observations::text)>8192 then raise exception 'Invalid availability evidence.';end if;
 select * into c from public.marketing_connections where id=p_connection;
 for o in select value from jsonb_array_elements(p_observations) loop
  if not marketing_private.publication_known(c.id,p_generation,o->>'id') then raise exception 'Availability identity is not known to this connection.';end if;
  if o->>'state' not in ('available','unavailable','access_restricted','temporarily_unavailable') or o->>'state' is null
   or coalesce(o->>'source','') not in ('owned_feed','object_read')
   or coalesce(o->>'reason','') not in ('provider_observed','object_missing_or_unreadable','not_public','identity_unverified','permission_or_token','provider_temporary','response_unverified')
   or (o->>'source'='owned_feed' and (o->>'state'<>'available' or o->>'reason'<>'provider_observed')) then raise exception 'Invalid availability classification.';end if;
  insert into marketing_private.publication_availability(connection_id,connection_generation,provider_account_id,provider_post_id,state,source,reason,checked_at,last_available_at,last_removal_at,last_removal_fingerprint)
  select c.id,p_generation,c.provider_account_id,o->>'id',coalesce(prior.state,'unknown'),coalesce(prior.source,'not_checked'),coalesce(prior.reason,'not_checked'),prior.checked_at,prior.last_available_at,prior.last_removal_at,prior.last_removal_fingerprint
  from (select 1) seed left join lateral(select * from marketing_private.publication_availability old where old.connection_id=c.id and old.provider_account_id=c.provider_account_id and old.provider_post_id=o->>'id' order by old.checked_at desc nulls last,old.connection_generation desc limit 1) prior on true on conflict do nothing;
  select * into a from marketing_private.publication_availability where connection_id=c.id and connection_generation=p_generation and provider_post_id=o->>'id' for update;
  observed_time:=clock_timestamp();
  can_restore:=o->>'state'='available' and (a.state<>'deleted' or o->>'source'='object_read' and observed_time>a.last_removal_at);
  -- An ambiguous read cannot erase signed removal proof. A later positive read can.
  next_state:=case when a.state='deleted' and not can_restore then a.state else o->>'state' end;
  next_reason:=case when a.state='deleted' and not can_restore then a.reason else o->>'reason' end;
  next_source:=case when a.state='deleted' and not can_restore then a.source else o->>'source' end;
  update marketing_private.publication_availability set state=next_state,reason=next_reason,source=next_source,
   checked_at=case when a.state='deleted' and not can_restore then a.checked_at else observed_time end,last_attempt_at=observed_time,
   last_available_at=case when can_restore then observed_time else a.last_available_at end,
   last_object_available_at=case when o->>'state'='available' and o->>'source'='object_read'
    and not exists(select 1 from marketing_private.publication_availability manual where manual.connection_id=c.id
      and manual.provider_account_id=c.provider_account_id and manual.provider_post_id=o->>'id' and manual.manual_sync_lease=p_lease)
    then observed_time else a.last_object_available_at end,
   next_check_at=observed_time+case when next_state='temporarily_unavailable' then interval '15 minutes' when next_state='deleted' then interval '24 hours' else interval '6 hours' end
  where connection_id=c.id and connection_generation=p_generation and provider_post_id=o->>'id';
 end loop;
end;$$;
revoke all on function marketing_private.record_publication_availability(uuid,integer,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.marketing_content_management(p_org uuid, p_brand uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_search text, p_channel text, p_status text, p_sort text, p_group text, p_page integer, p_page_size integer, p_view text, p_show_removed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,case when public.current_user_has_permission('marketing_calendar.view') then 'marketing_calendar.view' else 'marketing_content.view' end);
 if p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100)
 or p_view is null or p_view not in ('list','calendar') or p_sort is null or p_sort not in ('date_desc','date_asc','title','brand','status')
 or p_group is null or p_group not in ('','date','brand','status') or p_channel is null or p_channel not in ('','facebook','instagram')
 or p_status is null or p_status not in ('','draft','review','approved','scheduled','published','failed','rejected','cancelled','publishing','uncertain','awaiting_authorization')
 or p_search is null or length(p_search)>200 or (p_from is not null and p_to is not null and p_from>=p_to)
 or (p_view='calendar' and (p_from is null or p_to is null or p_to-p_from>interval '42 days')) then raise exception 'Invalid content filters.'; end if;
 with source as materialized (select * from marketing_private.content_rows(p_org,p_brand)), filtered as materialized (
  select x.*,to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') as day,
   case p_group when 'brand' then x.brand_name when 'status' then x.status when 'date' then to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') else '' end as group_key
  from source x
  where (p_view='list' or p_show_removed or not marketing_private.publication_fully_removed(channels)) and (p_view='list' or display_at is not null) and ((p_view='list' and p_status='draft') or ((p_from is null or display_at>=p_from) and (p_to is null or display_at<p_to)))
   and (p_search='' or position(lower(p_search) in lower(title||' '||coalesce((select string_agg(v->>'caption',' ') from jsonb_array_elements(channels) v),'')))>0)
   and (p_channel='' or exists(select 1 from jsonb_array_elements(channels) v where v->>'channel'=p_channel))
   and (p_status='' or status=p_status or exists(select 1 from jsonb_array_elements(channels) v where v->>'status'=p_status))
 ), ranked as (
  select f.*,row_number() over(partition by day order by display_at,key) as day_rank,
   row_number() over(order by case when p_group='date' and p_sort='date_desc' then group_key end desc,case when not(p_group='date' and p_sort='date_desc') then group_key end,
    case when p_sort='date_desc' then display_at end desc nulls last,
    case when p_sort='date_asc' then display_at end asc nulls last,
    case when p_sort='title' then lower(title) when p_sort='brand' then brand_name when p_sort='status' then status end,key) as rank
  from filtered f
 ), page_rows as (
  select * from ranked where case when p_view='calendar' then day_rank<=3 else rank>(p_page-1)*p_page_size and rank<=p_page*p_page_size end
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(q)-array['day_rank','rank'] order by rank) from page_rows q),'[]'::jsonb),
  'draft_count',(select count(*) from source where origin='feedx' and status='draft'),'total_count',(select count(*) from filtered),'day_counts',coalesce((select jsonb_object_agg(coalesce(day,'unscheduled'),n) from (select day,count(*) n from filtered group by day) d),'{}'::jsonb),
  'timezone','Asia/Kuala_Lumpur') into result;
 return result;
end;$function$;

revoke all on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text,boolean) from public,anon;
grant execute on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text,boolean) to authenticated;
CREATE OR REPLACE FUNCTION public.marketing_content_management(p_org uuid, p_brand uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_search text DEFAULT ''::text, p_channel text DEFAULT ''::text, p_status text DEFAULT ''::text, p_sort text DEFAULT 'date_desc'::text, p_group text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20, p_view text DEFAULT 'list'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select public.marketing_content_management(p_org,p_brand,p_from,p_to,p_search,p_channel,p_status,p_sort,p_group,p_page,p_page_size,p_view,false);
$function$;


