-- A historical Cloud API run owns the presentation of its campaign, even when the original draft used the manual adapter.
create function marketing_private.campaign_delivery_projection(c public.marketing_campaigns)
returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('delivery_mode',case when r.id is not null then 'whatsapp_cloud' else c.adapter end,
  'delivery_status',r.state) || case when r.id is not null then jsonb_build_object('can_revise',false) else '{}'::jsonb end
 from (select 1) anchor left join marketing_private.whatsapp_campaign_runs r on r.campaign_id=c.id and r.revision=c.revision
$$;
revoke all on function marketing_private.campaign_delivery_projection(public.marketing_campaigns) from public,anon,authenticated,service_role;

do $migration$
declare
 reader text:=pg_get_functiondef('public.marketing_outreach_read(uuid,uuid,uuid,integer,text)'::regprocedure);
 command text:=pg_get_functiondef('public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb)'::regprocedure);
 cloud_reader text:=pg_get_functiondef('public.marketing_campaign_whatsapp_read(uuid,uuid,uuid,integer)'::regprocedure);
 cloud_command text:=pg_get_functiondef('public.marketing_campaign_whatsapp_command(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure);
 projection constant text:='to_jsonb(c)||marketing_private.campaign_audience_projection(c)';
 list_result constant text:=$old$'campaigns',campaigns,'senders',senders$old$;
 manual_start constant text:=$old$ elsif p_action='sender_session' then$old$;
 manual_row constant text:=$old$  if p_action in ('open','confirm') and exists($old$;
 save_branch constant text:=$old$  if p_action='save' then$old$;
 save_new constant text:=$old$marketing_campaigns(organization_id,brand_id,title,audience_id,caption,asset_id,created_by) values(p_org,p_brand,trim(p_payload->>'title'),a.id,p_payload->>'caption',nullif(p_payload->>'asset_id','')::uuid,actor)$old$;
 queue_mode constant text:=$old$ or c.adapter<>'whatsapp_manual'$old$;
 cloud_schedule constant text:=$old$  if run.id is not null or c.status<>'ready'$old$;
 cloud_result constant text:=$old$'counts',summary,'total',total,'rows',rows$old$;
 cloud_receipt constant text:=$old$d.reason,d.provider_message_id,d.reply_conversation_id$old$;
begin
 if strpos(reader,projection)=0 or strpos(reader,list_result)=0 or strpos(command,manual_start)=0
  or strpos(command,manual_row)=0 or strpos(command,save_branch)=0 or strpos(command,save_new)=0
  or strpos(command,queue_mode)=0 or strpos(cloud_command,cloud_schedule)=0
  or strpos(cloud_reader,cloud_result)=0 or strpos(cloud_reader,cloud_receipt)=0
 then raise exception 'Unexpected campaign delivery mode baseline';end if;
 reader:=replace(reader,projection,projection||'||marketing_private.campaign_delivery_projection(c)');
 execute replace(reader,list_result,list_result||$new$,'cloud_sender',case when public.current_user_has_permission('marketing_campaigns.view') then
  (select jsonb_build_object('name',k.account_name,'id',k.id,'generation',k.credential_generation)
   from public.marketing_connections k where k.brand_id=p_brand and k.organization_id=p_org
    and marketing_private.whatsapp_campaign_connection(k)) end$new$);
 command:=replace(command,save_branch,save_branch||$new$
   if coalesce(p_payload->>'adapter','whatsapp_manual') not in ('whatsapp_manual','whatsapp_cloud')
    or (c.id is not null and coalesce(p_payload->>'adapter',c.adapter)<>c.adapter)
   then raise exception 'Campaign delivery mode cannot be changed.';end if;
   if exists(select 1 from marketing_private.whatsapp_campaign_runs w where w.campaign_id=c.id)
   then raise exception 'A Cloud API run already owns this campaign history.';end if;$new$);
 command:=replace(command,save_new,$new$marketing_campaigns(organization_id,brand_id,title,audience_id,caption,asset_id,created_by,adapter) values(p_org,p_brand,trim(p_payload->>'title'),a.id,p_payload->>'caption',nullif(p_payload->>'asset_id','')::uuid,actor,coalesce(p_payload->>'adapter','whatsapp_manual'))$new$);
 command:=replace(command,queue_mode,'');
 command:=replace(command,manual_start,$new$ elsif p_action='sender_session' then
  if exists(select 1 from public.marketing_campaigns manual_campaign
   where manual_campaign.id=p_id and manual_campaign.organization_id=p_org and manual_campaign.brand_id=p_brand
    and marketing_private.campaign_delivery_projection(manual_campaign)->>'delivery_mode'='whatsapp_cloud')
  then raise exception 'This campaign uses the authorized WhatsApp connection.';end if;$new$);
 execute replace(command,manual_row,$new$  if marketing_private.campaign_delivery_projection(c)->>'delivery_mode'='whatsapp_cloud' then
   raise exception 'Manual recipient actions are unavailable for this Cloud API campaign.';
  end if;
$new$||manual_row);
 execute replace(cloud_command,cloud_schedule,$new$  if c.adapter<>'whatsapp_cloud' then raise exception 'Choose a Cloud API campaign to schedule delivery.';end if;
$new$||cloud_schedule);
 cloud_reader:=replace(cloud_reader,cloud_receipt,$new$d.reason,
  case when (select marketing_private.actor_allowed(e.id,p_org,p_brand,'marketing_settings.configure')
   and marketing_private.actor_allowed(e.id,p_org,p_brand,'marketing_settings.view')
   from public.employees e where e.auth_user_id=auth.uid()) then d.provider_message_id end provider_message_id,d.reply_conversation_id$new$);
 execute replace(cloud_reader,cloud_result,cloud_result||$new$,
  'sender',(select k.account_name from public.marketing_connections k where k.id=run.connection_id
    and k.brand_id=p_brand and k.organization_id=p_org),
  'template_preview',run.template->'preview'$new$);
end;
$migration$;
