-- Read-only channel evidence. Worker due_at is a retry checkpoint, never a schedule.
create function marketing_private.publishing_job_timeline(j public.marketing_jobs)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare plan public.marketing_events; receipt_at timestamptz; started_at timestamptz; scheduled_at timestamptz; intention text; verified boolean;
begin
 if j.id is null then return '{}'::jsonb;end if;
 select e.* into plan from public.marketing_events e
 where e.content_id=j.content_id and e.organization_id=j.organization_id and e.brand_id=j.brand_id
  and e.details->>'revision'=j.revision::text
  and e.action in ('schedule','schedule_publish','publish_now','publisher_authorized','reschedule_channel')
  and (e.details->>'job_id' is null or e.details->>'job_id'=j.id::text)
 order by e.id desc limit 1;
 intention:=case when plan.action='publish_now' or plan.action='publisher_authorized' and plan.details->>'mode'='publish_now' then 'now'
  when plan.action in ('schedule','schedule_publish','reschedule_channel') or plan.action='publisher_authorized' and plan.details->>'mode'='schedule_publish' then 'schedule' end;
 if intention='schedule' then
  begin scheduled_at:=(plan.details->>'scheduled_at')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then scheduled_at:=null;end;
 end if;
 begin started_at:=(j.provider_state->>'started_at')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then started_at:=null;end;
 verified:=j.state='succeeded' and j.provider_post_id is not null and j.provider_state->>'post_id'=j.provider_post_id;
 if verified then
  select min(e.created_at) into receipt_at from public.marketing_events e
  where e.content_id=j.content_id and e.organization_id=j.organization_id and e.brand_id=j.brand_id
   and e.action='publishing_succeeded' and e.details->>'revision'=j.revision::text
   and e.details->>'job_id'=j.id::text and e.details->>'channel'=j.channel
   and e.details->>'provider_post_id'=j.provider_post_id;
 end if;
 return jsonb_build_object('scheduled_at',scheduled_at,'publishing_intention',intention,
  'processing_started_at',started_at,'receipt_confirmed_at',receipt_at,'receipt_verified',coalesce(verified,false),
  'receipt_permalink',case when verified and j.channel='facebook' and j.provider_post_id ~ '^[0-9]+_[0-9]+$'
   then 'https://www.facebook.com/'||split_part(j.provider_post_id,'_',1)||'/posts/'||split_part(j.provider_post_id,'_',2)||'/' end);
end;$$;
revoke all on function marketing_private.publishing_job_timeline(public.marketing_jobs) from public,anon,authenticated;

do $migration$
declare body text;
begin
 body:=pg_get_functiondef('marketing_private.content_rows(uuid,uuid,boolean)'::regprocedure);
 if md5(body)<>'13bf86fcf38ba5ccad2bbd2fada24b44' then raise exception 'Unexpected content rows baseline';end if;
 body:=replace(body,$old$'scheduled_at',coalesce(j.due_at,c.scheduled_at),'actual_at',s.published_at,'permalink',s.permalink$old$,
 $new$'scheduled_at',timeline.evidence->'scheduled_at','publishing_intention',timeline.evidence->'publishing_intention',
    'processing_started_at',timeline.evidence->'processing_started_at','receipt_confirmed_at',timeline.evidence->'receipt_confirmed_at',
    'receipt_verified',timeline.evidence->'receipt_verified','actual_at',s.published_at,
    'permalink',coalesce(nullif(s.permalink,''),timeline.evidence->>'receipt_permalink'),
    'permalink_source',case when nullif(s.permalink,'') is not null then 'meta_observation' when timeline.evidence->>'receipt_permalink' is not null then 'facebook_receipt' end$new$);
 body:=replace(body,$old$left join lateral (select s0.* from social s0$old$,
 $new$left join lateral (select marketing_private.publishing_job_timeline(j) as evidence) timeline on true
   left join lateral (select s0.* from social s0$new$);
 body:=replace(body,'end as status,c.revision,c.scheduled_at,c.schedule_timezone,r.payload',
  'end as status,c.revision,evidence.scheduled_at,c.schedule_timezone,r.payload');
 body:=replace(body,'coalesce(evidence.actual_at,c.scheduled_at,',
  'coalesce(evidence.actual_at,evidence.receipt_confirmed_at,evidence.scheduled_at,');
 body:=replace(body,'select max(s.published_at) as actual_at,jsonb_agg(',
  'select max(s.published_at) as actual_at,min((timeline.evidence->>''scheduled_at'')::timestamptz) as scheduled_at,max((timeline.evidence->>''receipt_confirmed_at'')::timestamptz) as receipt_confirmed_at,jsonb_agg(');
 execute body;
 body:=pg_get_functiondef('public.marketing_content_detail(uuid)'::regprocedure);
 if md5(body)<>'16f1eb5ec402ec5be9270aae09626fda' then raise exception 'Unexpected content detail baseline';end if;
 body:=replace(body,'assets jsonb; events jsonb;','assets jsonb; events jsonb; projection jsonb;');
 body:=replace(body,'return jsonb_build_object(''assets'',assets',
  'select to_jsonb(row) into projection from marketing_private.content_rows(c.organization_id,c.brand_id) row where row.id=c.id;
 return jsonb_build_object(''assets'',assets');
 body:=replace(body,'to_jsonb(c)||jsonb_build_object(''status'',(select status from marketing_private.content_rows(c.organization_id,c.brand_id) where id=c.id),''channels'',(select channels from marketing_private.content_rows(c.organization_id,c.brand_id) where id=c.id),',
  'to_jsonb(c)||coalesce(projection,''{}''::jsonb)||jsonb_build_object(');
 execute body;
end;$migration$;
