alter table public.marketing_reply_drafts add column whatsapp_template jsonb;

create function marketing_private.whatsapp_test_template_ready(c public.marketing_conversations, conn public.marketing_connections)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(c.id='4ea6db5b-1d11-4c51-a7c1-8e7cd9d369fa'
  and c.brand_id='3a60f950-9510-4538-b7de-93789573bc0b' and c.channel='whatsapp'
  and c.medium='dm' and c.takeover and not c.opted_out and c.status<>'resolved'
  and conn.id=c.connection_id and conn.brand_id=c.brand_id and conn.organization_id=c.organization_id
  and conn.whatsapp_onboarding_mode='cloud_api' and conn.provider_account_id='1221509657713215'
  and conn.whatsapp_waba_id='1675083730240518' and conn.credential_generation=c.connection_generation
  and marketing_private.whatsapp_receiving(conn.id)
  and exists(select 1 from marketing_private.inbox_authority a where a.connection_id=conn.id
   and a.generation=conn.credential_generation and a.signed_inbound_at is not null)
  and exists(select 1 from public.platform_customers customer
   where customer.organization_id=c.organization_id and customer.phone_e164='+'||c.participant_key
    and marketing_private.whatsapp_consent(c.brand_id,customer.id) is not null),false)
$$;
revoke all on function marketing_private.whatsapp_test_template_ready(public.marketing_conversations,public.marketing_connections) from public,anon,authenticated,service_role;

create function public.marketing_inbox_whatsapp_template_material(p_conversation uuid,p_auth_user uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c marketing_conversations; conn marketing_connections; actor uuid; credential jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 select * into c from marketing_conversations where id=p_conversation;
 select * into conn from marketing_connections where id=c.connection_id;
 select id into actor from employees where auth_user_id=p_auth_user;
 if not marketing_private.whatsapp_test_template_ready(c,conn)
  or not coalesce(marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.reply'),false)
  or not coalesce(marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.send'),false)
 then raise exception using errcode='42501',message='WhatsApp template send requires current connection, staff authority and recipient consent.';end if;
 select sealed_token into strict credential from marketing_private.credentials where connection_id=conn.id and expires_at>now();
 return jsonb_build_object('connection',to_jsonb(conn)||jsonb_build_object('sealed_token',credential),'account',conn.provider_account_id,'peer',c.participant_key);
end;$$;
revoke all on function public.marketing_inbox_whatsapp_template_material(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketing_inbox_whatsapp_template_material(uuid,uuid) to service_role;

create function public.marketing_inbox_prepare_whatsapp_template(
 p_request uuid,p_conversation uuid,p_version integer,p_body text,p_template jsonb,p_generation integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c marketing_conversations; conn marketing_connections; actor uuid; prior marketing_requests; fp text; new_draft_id uuid; result jsonb;
begin
 select * into c from marketing_conversations where id=p_conversation;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.reply');
 perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.send');
 if p_request is null or p_body is null or length(trim(p_body)) not between 1 and 2000
  or jsonb_typeof(p_template) is distinct from 'object' or length(p_template::text)>12000
  or coalesce(p_template->>'id','') !~ '^[0-9]{1,32}$' or coalesce(p_template->>'language','') !~ '^[a-z]{2,3}(_[A-Za-z]{2,8}){0,2}$'
 then raise exception 'Invalid WhatsApp template intent.';end if;
 fp:=encode(extensions.digest(jsonb_build_array('whatsapp_template',p_conversation,p_version,p_body,p_template,p_generation)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from marketing_requests where request_id=p_request;
 if found then
  if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Reply request changed.';end if;
  return prior.result;
 end if;
 select * into c from marketing_conversations where id=p_conversation for update;
 select * into conn from marketing_connections where id=c.connection_id;
 if c.version is distinct from p_version or conn.credential_generation is distinct from p_generation
  or not marketing_private.whatsapp_test_template_ready(c,conn)
  or marketing_private.inbox_reply_review_required(c.id) or cardinality(marketing_private.inbox_risk(p_body))>0
 then raise exception 'WhatsApp template authority or conversation changed.';end if;
 if exists(select 1 from marketing_reply_outbox o join marketing_reply_drafts d on d.id=o.draft_id
  where d.conversation_id=c.id and (o.state in ('prepared','pending','reconciling') or
   (d.source_version=c.version and d.whatsapp_template=p_template and o.state<>'failed')))
 then raise exception 'A reply is already in progress or recorded.';end if;
 insert into marketing_reply_drafts(conversation_id,body,source_version,provenance,status,created_by,reviewed_by,reviewed_at,staff_confirmed,whatsapp_template)
 values(c.id,p_body,c.version,'human','approved',actor,actor,now(),true,p_template) returning id into new_draft_id;
 insert into marketing_reply_outbox(draft_id,reason) values(new_draft_id,'staff_confirmed_template');
 perform public.marketing_inbox_prepare_send(p_request,new_draft_id);
 result:=jsonb_build_object('draft_id',new_draft_id);
 insert into marketing_requests values(p_request,actor,fp,result);
 return result;
end;$$;
revoke all on function public.marketing_inbox_prepare_whatsapp_template(uuid,uuid,integer,text,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.marketing_inbox_prepare_whatsapp_template(uuid,uuid,integer,text,jsonb,integer) to authenticated;

do $migration$
declare
 prepare_def text:=pg_get_functiondef('public.marketing_inbox_prepare_send(uuid,uuid)'::regprocedure);
 material_def text:=pg_get_functiondef('public.marketing_inbox_staff_send_material(uuid,uuid)'::regprocedure);
 old_window constant text:=$old$c.last_inbound_at is null or c.last_inbound_at>now() or c.last_inbound_at<=now()-interval '24 hours'$old$;
 old_material_window constant text:=$old$c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' or c.last_inbound_at>now()$old$;
 old_qa constant text:='marketing_private.whatsapp_test_staff_ready(c,conn)';
 new_qa constant text:='(case when d.whatsapp_template is null then marketing_private.whatsapp_test_staff_ready(c,conn) else marketing_private.whatsapp_test_template_ready(c,conn) end)';
 material_field constant text:=$old$'text',d.body,$old$;
begin
 if strpos(prepare_def,old_window)=0 or strpos(material_def,old_material_window)=0
  or strpos(prepare_def,old_qa)=0 or strpos(material_def,old_qa)=0 or strpos(material_def,material_field)=0
 then raise exception 'Unexpected template send authority baseline';end if;
 execute replace(replace(prepare_def,old_window,'(d.whatsapp_template is null and ('||old_window||'))'),old_qa,new_qa);
 execute replace(replace(replace(material_def,old_material_window,'(d.whatsapp_template is null and ('||old_material_window||'))'),old_qa,new_qa),
  material_field,material_field||$new$'whatsapp_template',d.whatsapp_template,$new$);
end;
$migration$;
