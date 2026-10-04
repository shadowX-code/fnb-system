-- Explicit synthetic Staging-only UI fixture; no real calendar publication.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$ declare ent uuid; outlet uuid; emp uuid; actor uuid:=payroll_admin_actor();begin
 select id into ent from legal_entities where company_registration_no='QA-PHP-20261004';
 select id into outlet from outlets where code='QA-PHP-1004';
 if ent is null or outlet is null then raise exception 'Existing labelled PH Profile fixture required';end if;
 perform legal_entity_save(ent,(select to_jsonb(l)||jsonb_build_object('is_active',true) from legal_entities l where id=ent));
 update outlets set is_active=true,status='active',updated_at=now() where id=outlet;
 if exists(select 1 from employees where employee_code='QA-PHT-UNVERIFIED-1004') then raise exception 'Fixture exists; inspect, do not recreate';end if;
 insert into employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality,enable_system_login,access_state)
 values('QA ONLY PH Treatment Unverified','QA-PHT-UNVERIFIED-1004',ent,'QA ONLY PH Profile Workplace','Service Crew','part_time','active','2026-08-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
 perform employee_employment_assignment_save(emp,'2026-08-01',jsonb_build_object('employment_type','part_time','employment_status','active','position','Service Crew','workplace','QA ONLY PH Profile Workplace','legal_entity_id',ent),'QA explicit synthetic assignment',null,'QA labelled fixture evidence');
 perform payroll_profile_create(emp,'2026-08-01','hourly',9,'MYR','QA ONLY pay evidence',null,outlet,false,false,false,false);
end $$;
commit;
