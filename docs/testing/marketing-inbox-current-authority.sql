-- Staging only. Exercise real canonical authorities with rollback-only evidence.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare c public.marketing_connections; actor uuid; v jsonb; evidence jsonb; key text; fp text:='current-authority-fixture'; original_caps jsonb; g integer; n integer;
begin
 select x.* into strict c from public.marketing_connections x join public.brands b on b.id=x.brand_id where b.name='Hola Hola Kopitiam' and x.channel='facebook';
 select auth_user_id into actor from public.employees where id=c.connected_by;
 original_caps:=c.capabilities;g:=c.credential_generation;
 -- Reproduce Production's old discovery scopes without changing credentials or execution.
 update public.marketing_connections set capabilities=jsonb_set(capabilities,'{granted_scopes}','["read_insights"]') where id=c.id;
 evidence:=jsonb_build_object('account_id',c.provider_account_id,'channel',c.channel,'page_id',c.provider_account_id,'authorization_verified',true,'token_verified',true,'account_verified',true,'scope_targets_verified',true,'subscriptions_verified',true,'page_tasks',jsonb_build_array('MESSAGING'),'granted_permissions',jsonb_build_array('pages_messaging','pages_manage_metadata'));
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence);
 assert v->>'receiving_verified'='true','Current validated authority must override stale discovery grants';
 assert (select credential_generation=g and capabilities->'execution_enabled' is not distinct from original_caps->'execution_enabled' from public.marketing_connections where id=c.id),'Generation/execution changed';
 assert (select granted_scopes @> array['pages_messaging','pages_manage_metadata'] from marketing_private.inbox_authority where connection_id=c.id),'Validated grant persistence';
 -- Existing signed evidence counts; recent API events never become delivery proof.
 update marketing_private.inbox_authority set webhook_verified=false,signed_inbound_at=null where connection_id=c.id;
 key:=c.id||':'||g||':incoming:current-authority-fixture';
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,state,error_code,evidence_source)
 values(key,c.id,g,jsonb_build_object('kind','incoming','medium','dm','event_id','current-authority-fixture','channel',c.channel,'account_id',c.provider_account_id,'peer_id','987654321','occurred_at',now()),fp,'blocked','messaging_authorization_unverified','recent_api');
 -- Eight historical API records stay blocked after successful health verification.
 for n in 1..8 loop
  insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,state,error_code,evidence_source)
  values(key||n,c.id,g,jsonb_build_object('kind','incoming','medium','dm','channel',c.channel,'account_id',c.provider_account_id,'peer_id','987654321','occurred_at',now()),fp,'blocked','messaging_authorization_unverified','recent_api');
 end loop;
 -- Existing Staging signed receipts are hidden only inside this rollback fixture.
 update marketing_private.inbox_events set evidence_source='recent_api' where connection_id=c.id and generation=g and evidence_source='signed_webhook';
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence);
 assert v->>'state'='awaiting_first_delivery' and v->>'delivery_verified'='false','API history cannot prove signed delivery';
 assert (select count(*)=8 from marketing_private.inbox_events where event_key like key||'_' and state='blocked'),'Health released historical API events';
 begin perform public.marketing_inbox_recover_signed_event(c.id,actor,g,key,fp);raise exception 'API event recovery accepted';exception when raise_exception then if sqlerrm='API event recovery accepted' then raise;end if;end;
 update marketing_private.inbox_events set evidence_source='signed_webhook' where event_key=key;
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence);
 assert v->>'delivery_verified'='true' and v->>'receiving_verified'='true','Hola signed delivery not recognized';
 assert (select state='blocked' from marketing_private.inbox_events where event_key=key),'Readiness must not replay old event';
 begin perform public.marketing_inbox_recover_signed_event(c.id,actor,g,key,'wrong');raise exception 'Fingerprint mismatch accepted';exception when raise_exception then if sqlerrm='Fingerprint mismatch accepted' then raise;end if;end;
 assert public.marketing_inbox_recover_signed_event(c.id,actor,g,key,fp)->>'state'='pending','Exact signed recovery';
 assert public.marketing_inbox_recover_signed_event(c.id,actor,g,key,fp)->>'state'='pending','Idempotent recovery';
 -- Drain only this rollback fixture through the unchanged canonical processor.
 update marketing_private.inbox_events set due_at='1900-01-01' where event_key=key;
 assert public.marketing_inbox_process_events(1)->>'processed'='1','Canonical signed event processing failed';
 assert (select count(*)=1 from public.marketing_conversation_messages m join public.marketing_conversations x on x.id=m.conversation_id where x.connection_id=c.id and x.connection_generation=g and m.provider_message_id='current-authority-fixture' and m.evidence_source='signed_webhook'),'Receipt attribution/deduplication failed';
 assert public.marketing_inbox_recover_signed_event(c.id,actor,g,key,fp)->>'state'='processed','Processed event replayed';
 -- Scope revocation, identity, g and actor fail closed.
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence||'{"authorization_verified":false,"granted_permissions":["pages_manage_metadata"]}');
 assert v->>'receiving_verified'='false' and v->>'state'='permission_unavailable','Revoked grant ignored';
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence||'{"account_verified":false}');
 assert v->>'receiving_verified'='false','Wrong account accepted';
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence||'{"scope_targets_verified":false}');
 assert v->>'receiving_verified'='false','Wrong scope target accepted';
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence||'{"page_tasks":[]}');
 assert v->>'receiving_verified'='false','Happiness unverified tasks accepted';
 begin perform public.marketing_inbox_record_verification(c.id,actor,g+1,evidence);raise exception 'Stale g accepted';exception when raise_exception then if sqlerrm='Stale g accepted' then raise;end if;end;
 begin perform public.marketing_inbox_record_verification(c.id,gen_random_uuid(),g,evidence);raise exception 'Foreign actor accepted';exception when insufficient_privilege then null;end;
 update marketing_private.inbox_authority set generation=g+1,receive_verified=true,configuration_verified=true where connection_id=c.id;
 assert marketing_private.inbox_channel(c.id)->>'receiving_verified'='false','Old authority g accepted';
 -- Legacy deployed verifier remains compatible; new verifier persists actual permissions.
 v:=public.marketing_inbox_record_verification(c.id,actor,g,evidence-'granted_permissions');
 assert v->>'receiving_verified'='true','Existing verifier incompatible';
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin perform public.marketing_inbox_recover_signed_event(c.id,actor,g,key,fp);raise exception 'Non-service recovery accepted';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('authenticated','public.marketing_inbox_recover_signed_event(uuid,uuid,integer,text,text)','EXECUTE'),'Recovery exposed to client';
end;$$;
rollback;
