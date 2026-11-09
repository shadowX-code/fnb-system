-- Replan an untouched run without replacing its approved template or recipient set.
do $migration$
declare
 command_def text:=pg_get_functiondef('public.marketing_campaign_whatsapp_command(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure);
 actions constant text:=$old$'schedule','pause','resume','cancel'$old$;
 approval constant text:=$old$if p_action='schedule' then perform marketing_private.require_access$old$;
 branch constant text:=$old$ else
  if run.id is null or run.id is distinct from (p_payload->>'run_id')::uuid$old$;
begin
 if strpos(command_def,actions)=0 or strpos(command_def,approval)=0 or strpos(command_def,branch)=0
 then raise exception 'Unexpected WhatsApp Campaign command baseline';end if;
 command_def:=replace(command_def,actions,actions||',''reschedule''');
 command_def:=replace(command_def,approval,$new$if p_action in ('schedule','reschedule') then perform marketing_private.require_access$new$);
 execute replace(command_def,branch,$new$ elsif p_action='reschedule' then
  if run.id is null or run.id is distinct from (p_payload->>'run_id')::uuid
   or run.scheduled_at is distinct from (p_payload->>'previous_schedule')::timestamptz
   or run.state not in ('scheduled','paused') or c.status<>'ready'
   or c.approved_revision is distinct from c.revision
  then raise exception 'Campaign schedule changed.';end if;

  select * into conn from marketing_connections k where k.id=run.connection_id
   and k.brand_id=c.brand_id and k.organization_id=c.organization_id
   and marketing_private.whatsapp_campaign_connection(k);
  due:=(p_payload->>'scheduled_at')::timestamptz;
  if conn.id is null or due is null or due<=now() or due>now()+interval '90 days'
   or due+(select max(d.due_at-run.scheduled_at) from marketing_private.whatsapp_campaign_deliveries d where d.run_id=run.id)>=conn.expires_at
  then raise exception 'Choose a future schedule within the verified WhatsApp credential lifetime.';end if;

  if not exists(select 1 from marketing_private.whatsapp_campaign_deliveries d where d.run_id=run.id)
   or exists(
    select 1 from marketing_private.whatsapp_campaign_deliveries d
    join marketing_campaign_recipients r on r.id=d.recipient_id
    where d.run_id=run.id and (d.state<>'scheduled' or d.attempted_at is not null
      or d.provider_message_id is not null or d.lease is not null
      or not marketing_private.whatsapp_campaign_recipient_eligible(r,c))
   )
  then raise exception 'Only an untouched run with an eligible recipient queue can be rescheduled.';end if;

  update marketing_private.whatsapp_campaign_deliveries
   set due_at=due+(due_at-run.scheduled_at) where run_id=run.id;
  update marketing_private.whatsapp_campaign_runs
   set scheduled_at=due,generation=conn.credential_generation,state='scheduled',actor_id=actor
   where id=run.id returning * into run;
 else
  if run.id is null or run.id is distinct from (p_payload->>'run_id')::uuid$new$);
end;
$migration$;
