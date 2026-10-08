-- Scoped Staging authority regression. Every fixture/publication rolls back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('qa.profile_definition',(select definition::text from public.recruitment_interview_profiles where profile_key='service_crew' order by version desc limit 1),true);
set local role authenticated;
do $qa$
declare d jsonb; d2 jsonb; original jsonb; p uuid; v3 jsonb:=current_setting('qa.profile_definition')::jsonb;
begin
 v3:=jsonb_set(v3,'{evidence_areas,0,rubric}',jsonb_build_object('levels',(select jsonb_agg(jsonb_build_object('level',i,'criteria','Observable role-specific criterion '||i||': checks an order and communicates a proportionate customer response.')) from generate_series(1,4) i)));
 d:=recruitment_prepare_profile_draft('service_crew',2);
 d2:=recruitment_prepare_profile_draft('service_crew',2);
 if d->>'id'<>d2->>'id' then raise exception 'Prepare duplicates draft'; end if;
 d:=recruitment_save_profile_draft((d->>'id')::uuid,(d->>'revision')::integer,v3);
 if d->'definition'<>v3 then raise exception 'Full definition roundtrip lost data'; end if;
 if not exists(select 1 from jsonb_array_elements(recruitment_profile_drafts()) x where x->>'id'=d->>'id' and x->'definition'=v3) then raise exception 'Saved draft cannot be resumed'; end if;
 begin perform recruitment_save_profile_draft((d->>'id')::uuid,1,v3||'{"role_context":"stale overwrite"}'); raise exception 'Stale save accepted'; exception when sqlstate '40001' then null; end;
 begin perform recruitment_publish_profile_draft((d->>'id')::uuid,1); raise exception 'Stale publication accepted'; exception when sqlstate '40001' then null; end;
 begin perform recruitment_publish_profile(v3,2); raise exception 'Legacy bypass accepted'; exception when sqlstate '55000' then null; end;
 original:=d;
 d:=recruitment_save_profile_draft((d->>'id')::uuid,(d->>'revision')::integer,jsonb_set(v3,'{evidence_areas,0,rubric,levels,0,criteria}','""'));
 begin perform recruitment_publish_profile_draft((d->>'id')::uuid,(d->>'revision')::integer); raise exception 'Invalid draft published'; exception when sqlstate '22023' then null; end;
 d:=recruitment_save_profile_draft((d->>'id')::uuid,(d->>'revision')::integer,v3);
 p:=recruitment_publish_profile_draft((d->>'id')::uuid,(d->>'revision')::integer);
 if p is distinct from recruitment_publish_profile_draft((d->>'id')::uuid,(d->>'revision')::integer) then raise exception 'Publication retry duplicates'; end if;
 begin perform recruitment_save_profile_draft((d->>'id')::uuid,(d->>'revision')::integer,v3); raise exception 'Published draft editable'; exception when sqlstate '55000' then null; end;
 if has_table_privilege('authenticated','recruitment_interview_profile_drafts','UPDATE') or has_table_privilege('authenticated','recruitment_interview_profile_drafts','SELECT') or has_function_privilege('authenticated','recruitment_publish_profile_version(jsonb,integer)','EXECUTE') then raise exception 'Draft authority bypass exposed'; end if;
end $qa$;
reset role;
do $qa$ begin
 if (select count(*) from recruitment_interview_profiles where version=3)<>1 then raise exception 'Publication version wrong'; end if;
 begin update recruitment_interview_profiles set definition='{}' where version=3; raise exception 'Published profile mutable'; exception when sqlstate '55000' then null; end;
 if (select count(*) from recruitment_interview_profile_drafts where status='draft')<>0 then raise exception 'Published draft still active'; end if;
end $qa$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $qa$ begin
 begin perform recruitment_profile_drafts(); raise exception 'Unauthorized read accepted'; exception when insufficient_privilege then null; end;
 begin perform recruitment_prepare_profile_draft('service_crew',3); raise exception 'Unauthorized write accepted'; exception when insufficient_privilege then null; end;
end $qa$;
set local role anon;
do $qa$ begin
 begin perform recruitment_profile_drafts(); raise exception 'Anonymous read accepted'; exception when insufficient_privilege then null; end;
 begin perform recruitment_save_profile_draft(gen_random_uuid(),1,'{}'); raise exception 'Anonymous save accepted'; exception when insufficient_privilege then null; end;
 begin perform recruitment_publish_profile_draft(gen_random_uuid(),1); raise exception 'Anonymous publication accepted'; exception when insufficient_privilege then null; end;
end $qa$;
rollback;
