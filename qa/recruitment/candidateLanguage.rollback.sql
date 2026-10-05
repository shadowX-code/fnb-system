-- Staging only: protected synthetic mutation rehearsal, every row rolls back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from recruitment_applications a join employees e on e.id=a.created_by where a.id='bc0441c8-ca38-47bc-94be-60b8217d710a'),true);
do $$
declare token text; app uuid; result jsonb; client uuid:=gen_random_uuid(); first uuid:=gen_random_uuid(); second uuid:=gen_random_uuid(); unit uuid:=gen_random_uuid(); snapshot jsonb; attempt uuid;
begin
 app:=recruitment_register_application('38611f75-363f-49a6-b3a4-62e09a47faea','{"full_name":"Synthetic language rollback","contact":"0000000317"}');
 token:=recruitment_issue_invitation(app,clock_timestamp()+interval '7 days');
 foreach snapshot in array array['"en"'::jsonb,'"ms"','"zh"','"yue"'] loop
  result:=recruitment_public_language(token,snapshot#>>'{}');
  if result->>'preferred_language'<>snapshot#>>'{}' then raise exception 'Language was not persisted';end if;
 end loop;
 result:=recruitment_public_language(token,'yue');
 if recruitment_public_entry(token)->>'preferred_language'<>'yue' then raise exception 'Cold bootstrap lost language';end if;
 begin perform recruitment_public_language(token,'unsupported');raise exception 'Bad language accepted';exception when sqlstate '22023' then null;end;
 begin perform recruitment_public_language(repeat('0',64),'en');raise exception 'Bad token accepted';exception when sqlstate '42501' then null;end;
 perform recruitment_public_confirm_profile(token,'Synthetic language rollback','0000000317');
 perform recruitment_public_consent(token,recruitment_current_consent_version(),'{"ai":true,"recording":true,"review":true}');
 select to_jsonb(s) into snapshot from recruitment_consents s join recruitment_interview_attempts a on a.id=s.attempt_id where a.application_id=app;
 perform recruitment_public_language(token,'yue');
 if (select to_jsonb(s)<>snapshot from recruitment_consents s join recruitment_interview_attempts a on a.id=s.attempt_id where a.application_id=app) then raise exception 'Consent evidence changed';end if;
 perform recruitment_public_ready(token,'{"camera":"ready","microphone":"ready"}');
 perform recruitment_recovery_begin(token,client,first,null);
 perform recruitment_recording_access(token,client,'open',jsonb_build_object('unit_id',unit,'recovery_id',first));
 result:=recruitment_recovery_context(token,client,first);attempt:=(result->>'attempt_id')::uuid;
 perform recruitment_recovery_connected(token,client,first,1);
 begin perform recruitment_public_language(token,'en');raise exception 'Active preference changed';exception when sqlstate '22023' then null;end;
 perform recruitment_recovery_pause(token,client,first,'page_backgrounded');
 perform recruitment_recovery_begin(token,client,second,first);
 if recruitment_public_entry(token)->>'preferred_language'<>'yue' then raise exception 'Reconstruction lost preference';end if;
 perform recruitment_revoke_invitation(app);
 begin perform recruitment_public_language(token,'en');raise exception 'Revoked token accepted';exception when sqlstate '42501' then null;end;
 token:=recruitment_issue_invitation(app,clock_timestamp()+interval '7 days');
 update recruitment_invitations set expires_at=clock_timestamp()-interval '1 second' where application_id=app and revoked_at is null;
 begin perform recruitment_public_language(token,'en');raise exception 'Expired token accepted';exception when sqlstate '42501' then null;end;
 if has_table_privilege('anon','public.recruitment_interview_attempts','UPDATE') or has_table_privilege('authenticated','public.recruitment_interview_attempts','UPDATE') then raise exception 'Direct write exposed';end if;
 if not (select relrowsecurity from pg_class where oid='public.recruitment_interview_attempts'::regclass) then raise exception 'RLS disabled';end if;
 if exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.recruitment_public_language(text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC execute exposed';end if;
end $$;
rollback;
