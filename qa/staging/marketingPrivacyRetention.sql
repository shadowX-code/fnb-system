-- Disposable synthetic contract checks only; always roll back. No Blob/customer operations.
begin;
do $$
declare event text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'); data jsonb; prepared jsonb; batch text; conv uuid:=gen_random_uuid(); c integer;
begin
 if has_function_privilege('anon','public.marketing_privacy_retention(text,text[],text,text)','execute') or has_function_privilege('authenticated','public.marketing_privacy_retention(text,text[],text,text)','execute') then raise exception 'Retention RPC exposed';end if;
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin perform public.marketing_privacy_retention('status');raise exception 'Missing service guard';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 data:=jsonb_build_object('id',event,'version',1,'project','ujkzdaaadnvcfayuldmh','method','operator_identity_review','created_at',now()-interval '91 days','case_hash',event,'verification_hash',event,'peers','[]'::jsonb,'grants','[]'::jsonb);
 insert into marketing_private.privacy_cases(case_hash,verification_hash,method,local_completed_at,completed_at,backup_state,processor_state,followup_evidence_hash)
 values(event,event,'operator_identity_review',now(),now(),'verified_expired','verified_deleted',event);
 insert into marketing_private.privacy_recovery_intents(id,payload,created_at,stored_at,digest,object_path)
 values(event,data,now()-interval '91 days',now()-interval '91 days',encode(extensions.digest(data::text,'sha256'),'hex'),'feedx/ujkzdaaadnvcfayuldmh/erasure/v1/'||event||'.json');
 begin perform public.marketing_privacy_retention('prepare',array[event,event],event);raise exception 'Duplicate scope accepted';exception when raise_exception then if sqlerrm='Duplicate scope accepted' then raise;end if;end;
 update marketing_private.privacy_recovery_intents set created_at=now() where id=event;
 begin perform public.marketing_privacy_retention('prepare',array[event],event);raise exception 'Young record accepted';exception when raise_exception then if sqlerrm='Young record accepted' then raise;end if;end;
 update marketing_private.privacy_recovery_intents set created_at=now()-interval '91 days' where id=event;
 update marketing_private.privacy_cases set backup_state='pending' where case_hash=event;
 begin perform public.marketing_privacy_retention('prepare',array[event],event);raise exception 'Pending followup accepted';exception when raise_exception then if sqlerrm='Pending followup accepted' then raise;end if;end;
 update marketing_private.privacy_cases set backup_state='verified_expired' where case_hash=event;
 insert into marketing_private.inbox_legal_holds(conversation_id,legal_basis,evidence_hash,review_at,case_hash) values(conv,'legal_claim',event,now()+interval '1 day',event);
 begin perform public.marketing_privacy_retention('prepare',array[event],event);raise exception 'Legal hold accepted';exception when raise_exception then if sqlerrm='Legal hold accepted' then raise;end if;end;
 delete from marketing_private.inbox_legal_holds where conversation_id=conv;
 prepared:=public.marketing_privacy_retention('prepare',array[event],event);batch:=prepared->>'batch_id';
 if batch is null then raise exception 'Missing checkpoint identity';end if;
 if public.marketing_privacy_retention('prepare',array[event],event)->>'batch_id'<>batch then raise exception 'Retry identity changed';end if;
 begin perform public.marketing_privacy_retention('finish',p_batch=>batch);raise exception 'Unverified checkpoint accepted';exception when raise_exception then if sqlerrm='Unverified checkpoint accepted' then raise;end if;end;
 perform public.marketing_privacy_retention('ack',p_batch=>batch);
 update marketing_private.privacy_compactions set reviewed_at=now()-interval '31 days' where id=batch;
 begin perform public.marketing_privacy_retention('material',p_batch=>batch);raise exception 'Expired review accepted';exception when raise_exception then if sqlerrm='Expired review accepted' then raise;end if;end;
 perform public.marketing_privacy_retention('review',p_batch=>batch,p_evidence=>event);
 perform public.marketing_privacy_retention('finish',p_batch=>batch);
 perform public.marketing_privacy_retention('finish',p_batch=>batch);
 if not exists(select 1 from marketing_private.privacy_recovery_intents where id=event and routine_deleted_at is not null and payload=data) then raise exception 'Minimal recovery authority lost';end if;
 select count(*) into c from marketing_private.privacy_retention_reviews where batch_id=batch;
 if c<>3 then raise exception 'Review audit missing';end if;
end;$$;
select 'PASS: role denial, bounded/duplicate scope, 90-day floor, pending followup, legal hold, immutable retry identity, checkpoint prerequisite, 30-day reviews, retry completion and retained recovery authority' as result;
rollback;
