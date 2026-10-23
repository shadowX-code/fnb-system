-- Channel operations retain the same jobs, immutable revision and request authority.
create function marketing_private.publishing_job_actions(j public.marketing_jobs)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare uncertain boolean; prepared boolean; recoverable boolean; generation_ok boolean;
begin
 if j.id is null then return '{}'::jsonb;end if;
 uncertain:=j.state in ('leased','reconciling','succeeded') or j.provider_post_id is not null
   or j.provider_state ? 'pending' or j.provider_state ? 'post_id' or coalesce(j.provider_state->'objects','{}'::jsonb) ? 'fb_finish';
 prepared:=coalesce(j.provider_state-'verified_assets','{}'::jsonb)<>'{}'::jsonb;
 generation_ok:=exists(select 1 from public.marketing_connections c where c.id=j.connection_id and c.organization_id=j.organization_id and c.brand_id=j.brand_id and c.channel=j.channel and c.credential_generation=j.connection_generation);
 recoverable:=j.error_code in ('meta_permission_or_token_invalid','publishing_eligibility_unverified','external_account_not_enabled','media_source_unavailable','meta_error_4','meta_error_17','meta_error_32','meta_error_613','meta_error_429','meta_transport_unavailable','meta_response_unavailable');
 return jsonb_build_object('can_cancel',not uncertain and j.state in ('blocked','queued','retry','failed'),
  'can_reschedule',not uncertain and not prepared and j.state in ('blocked','queued','retry'),
  'can_recover',not uncertain and generation_ok and recoverable and j.state='failed',
  'recovery_reason',case when uncertain then 'Delivery is complete, in progress or uncertain. Do not resend.' when j.state='failed' and not generation_ok then 'Connection generation changed. Reconcile the existing approval before recovery.' when j.state='failed' and not recoverable then 'This failure requires investigation or a new reviewed revision.' when j.state='failed' then 'Resolve the reported account or transport issue, then prepare recovery and approve execution again.' else null end);
end;$$;
revoke all on function marketing_private.publishing_job_actions(public.marketing_jobs) from public,anon,authenticated;

create function marketing_private.content_job_operation(c public.marketing_content, actor uuid, command text, payload jsonb)
returns public.marketing_content language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; actions jsonb; scheduled timestamptz; tz text;
begin
 if c.approved_revision is distinct from c.revision or c.status not in ('scheduled','failed') then raise exception 'Only the current approved publishing revision can be changed.';end if;
 select * into j from public.marketing_jobs where id=(payload->>'job_id')::uuid and content_id=c.id and revision=c.revision and brand_id=c.brand_id and organization_id=c.organization_id for update;
 if not found then raise exception 'Channel execution is unavailable.';end if;
 if (payload->>'confirm')::boolean is distinct from true then raise exception 'Confirm this channel operation.';end if;
 if (payload->>'expected_updated_at')::timestamptz is distinct from j.updated_at then raise exception using errcode='40001',message='Channel execution changed. Close and reopen before continuing.';end if;
 actions:=marketing_private.publishing_job_actions(j);
 if command='cancel_channel' then
  if actions->>'can_cancel' is distinct from 'true' then raise exception 'This channel cannot be cancelled while delivery is uncertain or complete.';end if;
  update public.marketing_jobs set state='cancelled',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
 elsif command='reschedule_channel' then
  if actions->>'can_reschedule' is distinct from 'true' then raise exception 'Only a channel without provider preparation can be rescheduled.';end if;
  scheduled:=(payload->>'scheduled_at')::timestamptz;tz:=payload->>'timezone';
  if scheduled is null or scheduled<=now() or not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Choose a future publishing time and valid timezone.';end if;
  update public.marketing_jobs set state='blocked',due_at=scheduled,external_authorized_at=null,error_code='provider_not_authorized',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
  update public.marketing_content set schedule_timezone=tz where id=c.id;
 elsif command='recover_channel' then
  perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.execute');
  if actions->>'can_recover' is distinct from 'true' then raise exception 'This failure cannot be safely retried. Investigate the existing evidence.';end if;
  -- Preparation evidence and attempt counts remain; only a new explicit execution approval can release it.
  update public.marketing_jobs set state='blocked',failures=0,external_authorized_at=null,error_code='recovery_approval_required',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
 else raise exception 'Unknown channel operation.';end if;
 update public.marketing_content set status=case
  when exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='failed') then 'failed'
  when exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state not in ('succeeded','cancelled')) then 'scheduled'
  when exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='cancelled') then 'cancelled' else 'published' end,
  scheduled_at=(select min(due_at) from public.marketing_jobs where content_id=c.id and revision=c.revision and state not in ('succeeded','cancelled')),updated_at=clock_timestamp() where id=c.id returning * into c;
 return c;
end;$$;
revoke all on function marketing_private.content_job_operation(public.marketing_content,uuid,text,jsonb) from public,anon,authenticated;

do $migration$
declare body text;
begin
 body:=pg_get_functiondef('public.marketing_content_command(uuid,text,uuid,uuid,uuid,integer,jsonb)'::regprocedure);
 if position($old$when 'retry' then 'marketing_content.publish'$old$ in body)=0 or position($old$if p_command='save' then$old$ in body)=0 then raise exception 'Unexpected content command baseline';end if;
 body:=replace(body,$old$when 'retry' then 'marketing_content.publish'$old$,$new$when 'retry' then 'marketing_content.publish' when 'reschedule_channel' then 'marketing_content.publish' when 'recover_channel' then 'marketing_content.publish' when 'cancel_channel' then 'marketing_content.cancel'$new$);
 body:=replace(body,$old$if p_command='save' then$old$,$new$if p_command in ('reschedule_channel','recover_channel','cancel_channel') then
   c:=marketing_private.content_job_operation(c,actor,p_command,p_payload);
 elsif p_command='save' then$new$);
 body:=replace(body,$old$'reason',left(p_payload->>'reason',2000)$old$,$new$'reason',left(p_payload->>'reason',2000),'job_id',p_payload->>'job_id','scheduled_at',p_payload->>'scheduled_at'$new$);
 execute body;
 -- A failed sibling cannot starve another still-approved, independently authorized channel.
 body:=pg_get_functiondef('public.marketing_claim_job()'::regprocedure);
 if position($old$c.status='scheduled'$old$ in body)=0 then raise exception 'Unexpected claim baseline';end if;
 execute replace(body,$old$c.status='scheduled'$old$,$new$c.status in ('scheduled','failed')$new$);
 body:=pg_get_functiondef('public.marketing_authorize_execution(uuid,uuid,integer,uuid[])'::regprocedure);
 if position($old$c.status<>'scheduled'$old$ in body)=0 then raise exception 'Unexpected execution baseline';end if;
 body:=replace(body,$old$c.status<>'scheduled'$old$,$new$c.status not in ('scheduled','failed')$new$);
 body:=replace(body,$old$if not (conn.capabilities->'formats')$old$,$new$if j.connection_id is not null and (j.connection_id<>conn.id or j.connection_generation is distinct from conn.credential_generation) then raise exception 'Connection generation changed. Existing preparation cannot be transferred.';end if;
  if not (conn.capabilities->'formats')$new$);
 execute body;
 -- One canonical channel projection serves List, Calendar, detail and Post Performance.
 body:=pg_get_functiondef('marketing_private.content_rows(uuid,uuid,boolean)'::regprocedure);
 if position($old$when j.state='failed' then 'failed' else c.status end$old$ in body)=0 then raise exception 'Unexpected channel projection';end if;
 body:=replace(body,$old$when j.state='failed' then 'failed' else c.status end$old$,$new$when j.state='failed' then 'failed' when j.state='leased' then 'publishing' when j.state='reconciling' then 'uncertain' when j.state in ('queued','retry') then 'scheduled' when j.state='blocked' then 'awaiting_authorization' when j.state='cancelled' then 'cancelled' else c.status end$new$);
 body:=replace(body,$old$'job_state',j.state$old$,$new$'job_id',j.id,'job_updated_at',j.updated_at,'attempts',j.attempts,'failures',j.failures,'operations',marketing_private.publishing_job_actions(j),'job_state',j.state$new$);
 body:=replace(body,$old$'scheduled_at',c.scheduled_at,'actual_at',s.published_at$old$,$new$'scheduled_at',coalesce(j.due_at,c.scheduled_at),'actual_at',s.published_at$new$);
 execute body;
 body:=pg_get_functiondef('public.marketing_content_detail(uuid)'::regprocedure);
 body:=replace(body,$old$'brand_name',(select name$old$,$new$'channels',(select channels from marketing_private.content_rows(c.organization_id,c.brand_id) where id=c.id),'brand_name',(select name$new$);
 execute body;
 body:=pg_get_functiondef('public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text)'::regprocedure);
 execute replace(body,$old$'failed','rejected','cancelled')$old$,$new$'failed','rejected','cancelled','publishing','uncertain','awaiting_authorization')$new$);
end;$migration$;
