-- Lost code-exchange responses are visible, and a provider removal requires a new generation.
do $$declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_whatsapp_connections(uuid,uuid)'::regprocedure);
 needle:=$part$'connections',result,'sending_enabled',false$part$;
 if strpos(f,needle)=0 then raise exception 'WhatsApp read baseline changed';end if;
 f:=replace(f,needle,$part$'connections',result,'signup_state',case when p_brand is not null and exists(select 1 from marketing_private.whatsapp_signup_sessions s where s.brand_id=p_brand and s.organization_id=p_org and s.consumed_at is not null and s.completed_at is null and s.expires_at>now()) then 'action_required' else 'not_connected' end,'sending_enabled',false$part$);execute f;
 f:=pg_get_functiondef('public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb)'::regprocedure);
 needle:=$part$set issue=p_evidence->>'issue',updated_at=now()$part$;
 if strpos(f,needle)=0 then raise exception 'WhatsApp verification baseline changed';end if;
 f:=replace(f,needle,$part$set issue=case when issue='provider_disconnected' then issue else p_evidence->>'issue' end,updated_at=now()$part$);
 needle:=$part$ else
 if (p_evidence->>'waba_id'$part$;
 if strpos(f,needle)=0 then raise exception 'WhatsApp verification transition changed';end if;
 f:=replace(f,needle,$part$ else
 if exists(select 1 from marketing_private.whatsapp_onboarding where connection_id=c.id and issue='provider_disconnected') then raise exception 'A disconnected provider requires a fresh signup generation.';end if;
 if (p_evidence->>'waba_id'$part$);execute f;
end;$$;
