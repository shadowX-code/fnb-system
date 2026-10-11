-- Read-only profile eligibility; no publishing or messaging authority changes.
create or replace function public.marketing_inbox_profile_material(p_conversation uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; conn public.marketing_connections; a marketing_private.inbox_authority; actor uuid; material jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 select * into c from public.marketing_conversations where id=p_conversation;
 select id into actor from public.employees where auth_user_id=p_auth_user;
 if c.id is null or actor is null or not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.view') then raise exception using errcode='42501',message='Inbox scope denied.';end if;
 select * into conn from public.marketing_connections where id=c.connection_id;
 select * into a from marketing_private.inbox_authority where connection_id=c.connection_id;
 if c.channel not in ('facebook','instagram') or c.medium<>'dm' or c.last_inbound_at is null or c.last_inbound_at>now() or c.participant_key !~ '^[0-9]{1,30}$' or c.connection_generation is distinct from conn.credential_generation or
 conn.status<>'test_authorized' or conn.expires_at<=now() or a.generation is distinct from conn.credential_generation or not coalesce(a.receive_verified and a.webhook_verified,false) then raise exception 'Customer profile unavailable.';end if;
 -- Inbox authority retains messaging tasks only. Reuse the exact OAuth authorizer's verified full task evidence for the same current grant.
 if c.channel='instagram' and not (a.page_tasks && array['MODERATE','PROFILE_PLUS_MODERATE'] or coalesce((conn.capabilities->>'page_tasks_verified'='true' and conn.capabilities->>'page_task_source'='accounts' and conn.capabilities->'page_tasks' ?| array['MODERATE','PROFILE_PLUS_MODERATE']),false)) then raise exception 'Profile task evidence unavailable.';end if;
 select to_jsonb(conn)||jsonb_build_object('sealed_token',s.sealed_token) into material from marketing_private.credentials s where s.connection_id=conn.id;
 if material is null then raise exception 'Customer profile unavailable.';end if;
 return jsonb_build_object('connection',material,'peer',c.participant_key,'generation',c.connection_generation);
end;$$;
revoke all on function public.marketing_inbox_profile_material(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_inbox_profile_material(uuid,uuid) to service_role;
