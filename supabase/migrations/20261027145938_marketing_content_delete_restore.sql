-- Deletion is retained cancellation evidence; restoration creates a fresh draft revision.
create function marketing_private.content_lifecycle_actions(c public.marketing_content) returns jsonb
language sql stable security definer set search_path=public as $$
 with evidence as (
  select coalesce(bool_and(j.state not in ('leased','reconciling','succeeded') and j.provider_post_id is null
   and coalesce(j.provider_state-'verified_assets','{}'::jsonb)='{}'::jsonb),true) safe,
   coalesce(bool_and(j.state='cancelled'),true) cancelled
  from public.marketing_jobs j where j.content_id=c.id
 ) select jsonb_build_object(
  'can_delete',c.status not in ('published','cancelled') and safe,
  'can_restore',c.status='cancelled' and safe and cancelled,
  'reason',case when not safe then 'Publishing has started or delivery evidence needs reconciliation. Published and uncertain channels cannot be deleted or restored.'
   when c.status='cancelled' and not cancelled then 'Some channel executions are still active. Reconcile them before restoring.' end)
 from evidence;
$$;
revoke all on function marketing_private.content_lifecycle_actions(public.marketing_content) from public,anon,authenticated,service_role;

create function marketing_private.content_lifecycle_operation(c public.marketing_content,actor uuid,command text,payload jsonb)
returns public.marketing_content language plpgsql security definer set search_path=public as $$
declare actions jsonb;body jsonb;original public.marketing_content:=c;
begin
 if payload->'confirm' is distinct from 'true'::jsonb then raise exception 'Confirm this content action.';end if;
 if (payload->>'expected_updated_at')::timestamptz is distinct from c.updated_at then
  raise exception using errcode='40001',message='Content or schedule changed. Close and reopen before continuing.';end if;
 -- The existing claim authority locks Content before its job; use the same order.
 perform 1 from public.marketing_jobs where content_id=c.id order by id for update;
 actions:=marketing_private.content_lifecycle_actions(c);
 if command='cancel' then
  if actions->>'can_delete' is distinct from 'true' then raise exception 'This post cannot be deleted. Reconcile published, in-progress or uncertain channels first.';end if;
  update public.marketing_jobs set state='cancelled',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
   where content_id=c.id and state<>'cancelled';
  update public.marketing_content set status='cancelled',updated_at=clock_timestamp() where id=c.id returning * into c;
 elsif command='restore' then
  if actions->>'can_restore' is distinct from 'true' then raise exception 'Only fully cancelled, unpublished content without uncertain delivery can be restored.';end if;
  select r.payload into strict body from public.marketing_content_revisions r where r.content_id=c.id and r.revision=c.revision;
  perform marketing_private.validate_content(c.organization_id,c.brand_id,body,false);
  insert into public.marketing_content_revisions(content_id,revision,payload,actor_employee_id,created_at)
   values(c.id,c.revision+1,body,actor,clock_timestamp());
  update public.marketing_content set revision=revision+1,status='draft',approved_revision=null,scheduled_at=null,schedule_timezone=null,updated_at=clock_timestamp()
   where id=c.id returning * into c;
  insert into public.marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details)
   values(c.organization_id,c.brand_id,c.id,'restored_from_cancelled',actor,jsonb_build_object(
    'source_revision',original.revision,'revision',c.revision,'source_scheduled_at',original.scheduled_at,
    'source_timezone',original.schedule_timezone,'payload_md5',md5(body::text)));
 else raise exception 'Unknown content lifecycle action.';end if;
 return c;
end;$$;
revoke all on function marketing_private.content_lifecycle_operation(public.marketing_content,uuid,text,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare f text;old text;
begin
 f:=pg_get_functiondef('public.marketing_content_command(uuid,text,uuid,uuid,uuid,integer,jsonb)'::regprocedure);
 if md5(f)<>'e1c81beec821c296c85f5c486f3ca62a' then raise exception 'Content command baseline changed';end if;
 f:=replace(f,$old$when 'cancel' then 'marketing_content.cancel' end;$old$,$new$when 'cancel' then 'marketing_content.cancel' when 'restore' then 'marketing_content.edit' end;$new$);
 f:=replace(f,$old$if p_command in ('publish_now','schedule_publish') then$old$,$new$if p_command in ('cancel','restore') then
   c:=marketing_private.content_lifecycle_operation(c,actor,p_command,p_payload);
 elsif p_command in ('publish_now','schedule_publish') then$new$);
 f:=replace(f,$old$if c.status='published' then raise exception$old$,$new$if c.status='cancelled' then raise exception 'Restore this deleted post before editing. A fresh publishing confirmation is required.';end if;
   if c.status='published' then raise exception$new$);
 old:=$old$ elsif p_command='cancel' then
   if c.status in ('published','cancelled') or exists(select 1 from public.marketing_jobs where content_id=c.id and state in ('leased','reconciling','succeeded')) then raise exception 'Content cannot be cancelled while delivery is uncertain or complete.'; end if;
   update public.marketing_jobs set state='cancelled',updated_at=now() where content_id=c.id and state<>'succeeded';
   update public.marketing_content set status='cancelled',updated_at=now() where id=c.id returning * into c;
$old$;
 if position(old in f)=0 then raise exception 'Cancellation branch changed';end if;
 f:=replace(f,old,'');
 f:=replace(f,'result:=to_jsonb(c);',$new$result:=to_jsonb(c)||case when p_command='restore' then jsonb_build_object('payload',body) else '{}'::jsonb end;$new$);
 execute f;

 f:=pg_get_functiondef('public.marketing_content_detail(uuid)'::regprocedure);
 if position($old$'brand_name',(select name$old$ in f)=0 then raise exception 'Content detail baseline changed';end if;
 execute replace(f,$old$'brand_name',(select name$old$,$new$'lifecycle',marketing_private.content_lifecycle_actions(c),'brand_name',(select name$new$);

 f:=pg_get_functiondef('marketing_private.content_rows(uuid,uuid,boolean)'::regprocedure);
 old:=$old$case when c.status in ('scheduled','failed') then case$old$;
 if position(old in f)=0 then raise exception 'Content status baseline changed';end if;
 f:=replace(f,old,$new$case when c.status in ('scheduled','failed','cancelled') then case
    when exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'status'='uncertain') then 'uncertain'
    when c.status='cancelled' and exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='succeeded') then 'published'
    when c.status='cancelled' and exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state' in ('queued','retry')) then 'scheduled'
    when c.status='cancelled' and exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='blocked') then 'awaiting_authorization'$new$);
 old:=$old$when j.state='succeeded' then 'published' when j.state='failed'$old$;
 if position(old in f)=0 then raise exception 'Channel status baseline changed';end if;
 execute replace(f,old,$new$when j.state='succeeded' then 'published' when j.state='cancelled' and (j.provider_post_id is not null or coalesce(j.provider_state-'verified_assets','{}'::jsonb)<>'{}'::jsonb) then 'uncertain' when j.state='failed'$new$);

 -- Keep existing readers compatible; the new flag is explicit and independent of Meta removal.
 f:=pg_get_functiondef('public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text,boolean)'::regprocedure);
 if md5(f)<>'19d4fb91c40ad75296f1d72bb1a1a35f' then raise exception 'Content Management baseline changed';end if;
 f:=replace(f,'p_show_removed boolean)','p_show_removed boolean, p_show_deleted boolean)');
 f:=replace(f,'from source x
  where',$new$from source x
  where (p_show_deleted is true or p_status='cancelled' or status<>'cancelled') and$new$);
 execute f;
end;$migration$;
revoke all on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text,boolean,boolean) to authenticated;

create or replace function public.marketing_content_management(p_org uuid,p_brand uuid,p_from timestamptz,p_to timestamptz,p_search text,p_channel text,p_status text,p_sort text,p_group text,p_page integer,p_page_size integer,p_view text,p_show_removed boolean)
returns jsonb language sql stable security definer set search_path=public as $$
 select public.marketing_content_management(p_org,p_brand,p_from,p_to,p_search,p_channel,p_status,p_sort,p_group,p_page,p_page_size,p_view,p_show_removed,false);
$$;
