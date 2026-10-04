-- Canonical RPCs and immutable consent evidence, with rollback-only synthetic masters.
begin;
create function pg_temp.assert(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',message;end if;end$$;
do $$
declare actor uuid; identity uuid; position_id uuid:=gen_random_uuid(); entity uuid:=gen_random_uuid(); opening uuid; app uuid; token text; entry jsonb; snapshot jsonb; accepted constant jsonb:='{"ai":true,"recording":true,"review":true}';
begin
 select e.id,e.auth_user_id into actor,identity from employees e join roles r on r.id=e.role_id where r.name='owner' and e.enable_system_login and e.access_state='active' and e.is_active limit 1;
 if actor is null then raise exception 'Existing authorized QA actor required';end if;
 perform set_config('request.jwt.claim.sub',identity::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',identity,'role','authenticated')::text,true);
 insert into job_positions(id,name,department) values(position_id,'QA Consent '||position_id,'QA');
 insert into legal_entities(id,legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id) values(entity,'QA Consent',entity::text,'QA ONLY',actor,actor);
 opening:=recruitment_save_opening(jsonb_build_object('title','QA Consent rollback','position_id',position_id,'workplace','Management','legal_entity_id',entity,'status','open','config',jsonb_build_object('required_topics',jsonb_build_array('Experience'),'scenario_briefs','[]'::jsonb,'target_minutes',9,'max_minutes',10)));
 app:=recruitment_register_application(opening,jsonb_build_object('full_name','QA Consent '||position_id,'contact','QA-'||position_id));
 token:=recruitment_issue_invitation(app,clock_timestamp()+interval '2 hours');
 entry:=recruitment_public_entry(token);
 perform pg_temp.assert(entry->>'copy_version'='feedx-interview-v1-approved' and entry->>'consent_status'='approved','New invitation did not select approved copy');
 perform recruitment_public_confirm_profile(token,'QA Consent '||position_id,'QA-'||position_id);
 begin perform recruitment_public_consent(token,'phase1-provisional-v1',accepted);raise exception 'Stale version accepted';exception when invalid_parameter_value then null;end;
 begin perform recruitment_public_consent(token,'feedx-interview-v1-approved','{"ai":true,"recording":false,"review":true}');raise exception 'Recording purpose skipped';exception when invalid_parameter_value then null;end;
 entry:=recruitment_public_consent(token,'feedx-interview-v1-approved',accepted);
 snapshot:=entry->'consent_copy';
 perform pg_temp.assert(entry->>'status'='consented','Consent did not advance preparation');
 perform pg_temp.assert(recruitment_public_consent(token,'feedx-interview-v1-approved',accepted)=entry,'Identical consent retry changed evidence');
 perform pg_temp.assert((select count(*)=1 from recruitment_consents where application_id=app),'Consent retry duplicated evidence');
 begin update recruitment_consents set copy_snapshot='{}' where application_id=app;raise exception 'Snapshot changed';exception when object_not_in_prerequisite_state then null;end;
 insert into recruitment_consent_copy_versions(version,copy,status,created_at) values('qa-later-approved',jsonb_build_object('title','QA later'),'approved',clock_timestamp()+interval '1 minute');
 perform pg_temp.assert(recruitment_public_entry(token)->'consent_copy'=snapshot and recruitment_public_entry(token)->>'copy_version'='feedx-interview-v1-approved','Later copy rewrote accepted evidence');
 begin perform recruitment_public_consent(token,'qa-later-approved',accepted);raise exception 'Accepted consent replaced';exception when invalid_parameter_value then null;end;
 perform pg_temp.assert(recruitment_admin_data()->>'consent_status'='approved','Admin copy readiness incorrect');
 perform pg_temp.assert(recruitment_admin_evidence(app)->>'launch_ready'='true','Evidence read signature lost approved copy readiness');
 perform recruitment_revoke_invitation(app);
 perform pg_temp.assert(recruitment_public_entry(token)->>'available'='false','Revoked invitation exposed approved copy/profile');
 perform pg_temp.assert(has_function_privilege('anon','recruitment_public_consent(text,text,jsonb)','execute') and not has_function_privilege('anon','recruitment_current_consent_version()','execute') and not has_table_privilege('anon','recruitment_consent_copy_versions','select'),'Public boundary changed');
 raise notice 'Approved selection, stale/partial consent denial, immutable snapshots, retry/version pinning, scoped read compatibility and revocation passed';
end$$;
rollback;
