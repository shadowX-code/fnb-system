-- One transactional publisher-authorized path; existing jobs and execution guards remain authoritative.
create function marketing_private.direct_publish(c public.marketing_content,actor uuid,mode text,payload jsonb)
returns public.marketing_content language plpgsql security definer set search_path=public as $$
declare body jsonb;variant jsonb;expected jsonb;conn public.marketing_connections;selected uuid[]:='{}';due timestamptz;
begin
 perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.execute');
 if octet_length(payload::text)>10000 then raise exception 'Publishing confirmation is too large.';end if;
 if mode not in ('publish_now','schedule_publish') or payload->'confirm' is distinct from 'true'::jsonb then raise exception 'Explicit publishing confirmation is required.';end if;
 if c.status not in ('draft','approved') or c.status='approved' and c.approved_revision is distinct from c.revision then raise exception 'This revision requires its existing Review/Approval workflow or delivery reconciliation.';end if;
 if exists(select 1 from marketing_jobs where content_id=c.id and (revision=c.revision or state in ('leased','reconciling','succeeded'))) then raise exception 'Publishing jobs already exist. Reconcile or use the existing channel operations.';end if;
 select payload_.payload into body from marketing_content_revisions payload_ where content_id=c.id and revision=c.revision;
 perform marketing_private.validate_content(c.organization_id,c.brand_id,body,true);
 if payload->>'timezone' is distinct from 'Asia/Kuala_Lumpur' then raise exception 'Use Asia/Kuala_Lumpur publishing time.';end if;
 due:=case when mode='publish_now' then clock_timestamp() else (payload->>'scheduled_at')::timestamptz end;
 if due is null or mode='schedule_publish' and due<=clock_timestamp() then raise exception 'Choose a valid future publishing date and time.';end if;
 if jsonb_typeof(payload->'accounts') is distinct from 'array' or jsonb_array_length(payload->'accounts')<>jsonb_array_length(body->'variants') then raise exception 'Confirm one eligible account for each channel.';end if;
 for variant in select value from jsonb_array_elements(body->'variants') loop
  if (select count(*) from jsonb_array_elements(payload->'accounts') a where a->>'channel'=variant->>'channel')<>1 then raise exception 'Confirm one eligible account for each channel.';end if;
  select a into expected from jsonb_array_elements(payload->'accounts') a where a->>'channel'=variant->>'channel';
  select * into conn from marketing_connections where id=(expected->>'connection_id')::uuid and organization_id=c.organization_id and brand_id=c.brand_id and channel=variant->>'channel' for share;
  if not found or conn.credential_generation is distinct from (expected->>'generation')::integer or conn.provider_account_id is distinct from expected->>'provider_account_id' then raise exception 'Account identity or credential generation changed. Reload before publishing.';end if;
  if coalesce((conn.capabilities->'formats') ? (variant->>'format'),false) is not true then raise exception 'This account does not support the selected format.';end if;
  selected:=array_append(selected,conn.id);
 end loop;
 for variant in select value from jsonb_array_elements(body->'variants') loop
  insert into marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,error_code)
  values(c.organization_id,c.brand_id,c.id,c.revision,variant->>'channel','blocked',due,actor,'provider_not_authorized');
 end loop;
 -- This pins exact publisher authorization; it does not fabricate a reviewer approval event.
 update marketing_content set approved_revision=revision,status='scheduled',scheduled_at=due,schedule_timezone='Asia/Kuala_Lumpur',updated_at=clock_timestamp() where id=c.id returning * into c;
 perform public.marketing_authorize_execution(gen_random_uuid(),c.id,c.revision,selected);
 insert into marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details)
 values(c.organization_id,c.brand_id,c.id,'publisher_authorized',actor,jsonb_build_object('revision',c.revision,'mode',mode,'scheduled_at',due,'authorization_path',case when c.approved_revision=c.revision then 'publisher_confirmation' end));
 return c;
end;$$;
revoke all on function marketing_private.direct_publish(public.marketing_content,uuid,text,jsonb) from public,anon,authenticated;

do $migration$
declare body text;
begin
 body:=pg_get_functiondef('public.marketing_content_command(uuid,text,uuid,uuid,uuid,integer,jsonb)'::regprocedure);
 if position($old$when 'schedule' then 'marketing_content.publish'$old$ in body)=0 or position($old$if p_command in ('reschedule_channel','recover_channel','cancel_channel') then$old$ in body)=0 then raise exception 'Unexpected content command baseline';end if;
 body:=replace(body,$old$when 'schedule' then 'marketing_content.publish'$old$,$new$when 'schedule' then 'marketing_content.publish' when 'publish_now' then 'marketing_content.publish' when 'schedule_publish' then 'marketing_content.publish'$new$);
 body:=replace(body,$old$if p_command in ('reschedule_channel','recover_channel','cancel_channel') then$old$,$new$if p_command in ('publish_now','schedule_publish') then
   c:=marketing_private.direct_publish(c,actor,p_command,p_payload);
 elsif p_command in ('reschedule_channel','recover_channel','cancel_channel') then$new$);
 execute body;
 body:=pg_get_functiondef('public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text)'::regprocedure);
 if position($old$(p_from is null or display_at>=p_from) and (p_to is null or display_at<p_to)$old$ in body)=0 then raise exception 'Unexpected content filter baseline';end if;
 body:=replace(body,$old$(p_from is null or display_at>=p_from) and (p_to is null or display_at<p_to)$old$,$new$((p_view='list' and p_status='draft') or ((p_from is null or display_at>=p_from) and (p_to is null or display_at<p_to)))$new$);
 body:=replace(body,$old$'total_count',(select count(*) from filtered)$old$,$new$'draft_count',(select count(*) from source where origin='feedx' and status='draft'),'total_count',(select count(*) from filtered)$new$);
 execute body;
 body:=pg_get_functiondef('marketing_private.content_rows(uuid,uuid,boolean)'::regprocedure);
 if position('c.id,c.brand_id,b.name as brand_name,c.status,c.revision' in body)=0 then raise exception 'Unexpected status projection';end if;
 body:=replace(body,'c.id,c.brand_id,b.name as brand_name,c.status,c.revision',$new$c.id,c.brand_id,b.name as brand_name,
   case when c.status in ('scheduled','failed') then case
    when exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='reconciling') then 'uncertain'
    when exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='leased') then 'publishing'
    when exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='failed') then 'failed'
    else c.status end else c.status end as status,c.revision$new$);
 execute body;
 body:=pg_get_functiondef('public.marketing_content_detail(uuid)'::regprocedure);
 if position($old$'channels',(select channels$old$ in body)=0 then raise exception 'Unexpected detail projection';end if;
 execute replace(body,$old$'channels',(select channels$old$,$new$'status',(select status from marketing_private.content_rows(c.organization_id,c.brand_id) where id=c.id),'channels',(select channels$new$);
end;$migration$;
