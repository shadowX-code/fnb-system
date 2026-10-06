-- Rollback-only isolated fixtures matching all four September Production Run shapes.
-- Run after the population-completeness migration on Staging only.
begin;
create schema qa_payroll_population;
create table qa_payroll_population.employees(id uuid primary key, joined_date date);
create table qa_payroll_population.payroll_periods(id uuid primary key, period_start date, period_end date, legal_entity_id uuid);
create table qa_payroll_population.employee_employment_assignment_revisions(
id uuid primary key,employee_id uuid,effective_from date,employment_type text,employment_status text,
position text,legal_entity_id uuid,workplace text,employment_end_date date,source_kind text,
corrects_revision_id uuid,supersedes_revision_id uuid,recorded_at timestamptz default now());
CREATE OR REPLACE FUNCTION qa_payroll_population.employee_employment_assignment_at(p_employee_id uuid, p_on date)
 RETURNS qa_payroll_population.employee_employment_assignment_revisions
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'qa_payroll_population'
AS $function$
  select r from qa_payroll_population.employee_employment_assignment_revisions r
  where r.employee_id=p_employee_id and r.effective_from<=p_on
    and not exists (select 1 from qa_payroll_population.employee_employment_assignment_revisions newer
      where newer.supersedes_revision_id=r.id)
    and not (r.source_kind='cutover_current' and exists (
      select 1 from qa_payroll_population.employee_employment_assignment_revisions correction
      where correction.employee_id=r.employee_id
        and correction.source_kind='admin_change'
        and correction.corrects_revision_id=r.id
        and correction.effective_from<r.effective_from))
  order by r.effective_from desc,r.recorded_at desc,r.id desc limit 1;
$function$;

-- Population completeness is separate from inclusion. Unknown employer/history
-- can affect any entity; today's employer, status and workplace cannot exclude it.
create function qa_payroll_population.payroll_period_population_gaps(p_period_id uuid)
returns table(employee_id uuid, date_from date, date_to date, issue text, missing_field text)
language sql stable security definer set search_path=qa_payroll_population as $$
  with daily as materialized (
    select e.id employee_id,e.joined_date,p.legal_entity_id,d.work_date::date work_date,
      qa_payroll_population.employee_employment_assignment_at(e.id,d.work_date::date) assignment
    from qa_payroll_population.payroll_periods p
    cross join qa_payroll_population.employees e
    cross join lateral generate_series(greatest(p.period_start,coalesce(e.joined_date,p.period_start)),
      p.period_end,interval '1 day') d(work_date)
    where p.id=p_period_id
  ), unresolved as (
    select employee_id,work_date,
      case when (assignment).id is null then 'employment_history_unresolved'
        when (assignment).legal_entity_id is null then 'legal_employer_unresolved'
        else 'employment_joined_date_missing' end issue,
      case when (assignment).id is null then 'employment_assignment'
        when (assignment).legal_entity_id is null then 'legal_entity_id'
        else 'joined_date' end missing_field
    from daily
    where (assignment).id is null
      or ((assignment).employment_status='active'
        and ((assignment).employment_end_date is null or work_date<=(assignment).employment_end_date)
        and ((assignment).legal_entity_id is null
          or ((assignment).legal_entity_id=legal_entity_id and joined_date is null)))
  ), islands as (
    select *,work_date-(row_number() over(partition by employee_id,issue,missing_field order by work_date))::int island
    from unresolved
  )
  select employee_id,min(work_date),max(work_date),issue,missing_field from islands
    group by employee_id,issue,missing_field,island order by min(work_date),employee_id;
$$;
revoke all on function qa_payroll_population.payroll_period_population_gaps(uuid) from public,anon,authenticated;

create or replace function qa_payroll_population.payroll_period_employment_scope_issue(p_period_id uuid)
returns text language sql stable security definer set search_path=qa_payroll_population as $$
  select case when not exists(select 1 from qa_payroll_population.payroll_periods where id=p_period_id)
    then 'employment_period_unresolved'
    when exists(select 1 from qa_payroll_population.payroll_period_population_gaps(p_period_id))
    then 'employment_population_requires_review' else null end;
$$;
revoke all on function qa_payroll_population.payroll_period_employment_scope_issue(uuid) from public,anon,authenticated;


insert into qa_payroll_population.payroll_periods values('ee4cdd64-15a4-43ce-a177-de6c37551616','2026-09-01','2026-09-30','5514e530-e0c4-4f2f-9779-4dd4b06a6709');
insert into qa_payroll_population.payroll_periods values('067ef239-1eef-4af4-b94d-f9e79518f708','2026-09-01','2026-09-30','b54bb901-3790-4e55-8ab1-571768b44665');
insert into qa_payroll_population.payroll_periods values('a84447ab-35dc-4f71-af88-95620d4e3cab','2026-09-01','2026-09-30','bcd86ee3-0b72-4117-bdd4-26b59f3e3740');
insert into qa_payroll_population.payroll_periods values('c25bbaaf-034c-472a-b5a6-a0be1440deec','2026-09-01','2026-09-30','adba905b-954b-4965-93dd-efe9cc1c5536');
insert into qa_payroll_population.employees values('8d982b85-c020-4100-bc1f-a0f02a51ba3b','2026-02-17');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('6d610c5e-ddd0-4bd0-8881-02290d670393','8d982b85-c020-4100-bc1f-a0f02a51ba3b','2026-02-17','part_time','active','Service Crew','5514e530-e0c4-4f2f-9779-4dd4b06a6709','Friends Corner','admin_change');
insert into qa_payroll_population.employees values('773249de-7a50-4840-9336-a874d9dc1285','2025-11-03');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('1093d831-351a-42d1-a47f-4e3dafe1d0dc','773249de-7a50-4840-9336-a874d9dc1285','2025-11-03','part_time','active','Service Crew','5514e530-e0c4-4f2f-9779-4dd4b06a6709','Friends Corner','admin_change');
insert into qa_payroll_population.employees values('13dd4d2d-4804-4239-b82b-20f561849fd3','2026-05-11');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('5733ae4d-6aa5-4d2d-90b3-061fbe4b6a6b','13dd4d2d-4804-4239-b82b-20f561849fd3','2026-05-11','part_time','active','Service Crew','5514e530-e0c4-4f2f-9779-4dd4b06a6709','Friends Corner','admin_change');
insert into qa_payroll_population.employees values('73c38fda-340b-43cd-b425-f499c30f5698','2026-02-25');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('13030d6a-2f11-47a3-bdd4-3bef565d3c99','73c38fda-340b-43cd-b425-f499c30f5698','2026-02-25','part_time','active','Service Crew','5514e530-e0c4-4f2f-9779-4dd4b06a6709','Friends Corner','admin_change');
insert into qa_payroll_population.employees values('06b34c70-5a24-40e2-9262-9ccb2b762cf9','2026-05-03');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('a60c6731-b472-46ed-846f-06473d4c35e7','06b34c70-5a24-40e2-9262-9ccb2b762cf9','2026-05-03','part_time','active','Service Crew','5514e530-e0c4-4f2f-9779-4dd4b06a6709','Friends Corner','admin_change');
insert into qa_payroll_population.employees values('f6b1df92-f615-4585-a0ee-49dd5f7ebb91','2026-02-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('499aed7a-b2c6-428c-8918-c7a7b1889642','f6b1df92-f615-4585-a0ee-49dd5f7ebb91','2026-02-01','full_time','active','Service Crew','b54bb901-3790-4e55-8ab1-571768b44665','JYMT Kopitiam','admin_change');
insert into qa_payroll_population.employees values('177ec932-da8f-4b59-b239-e14a51360dc1','2026-09-26');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('73433b32-4fbe-4e08-a0eb-7e952d7d38d6','177ec932-da8f-4b59-b239-e14a51360dc1','2026-09-26','part_time','active','Service Crew','b54bb901-3790-4e55-8ab1-571768b44665','JYMT Kopitiam','admin_change');
insert into qa_payroll_population.employees values('fadcb4cd-af3a-407d-912a-74e1d78c447e','2026-03-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('be00acf2-07a8-4fba-b2ca-7eb393d55b9e','fadcb4cd-af3a-407d-912a-74e1d78c447e','2026-07-01','full_time','active','Accounts Executive','b54bb901-3790-4e55-8ab1-571768b44665','Management','admin_change');
insert into qa_payroll_population.employees values('d04aab2b-20ea-4edb-887d-ddaecdd80644','2026-03-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('7d51514a-3f01-42cb-969f-1708602da3f3','d04aab2b-20ea-4edb-887d-ddaecdd80644','2026-03-01','full_time','active','Marketing Manager','b54bb901-3790-4e55-8ab1-571768b44665','Management','admin_change');
insert into qa_payroll_population.employees values('7c219bb1-ee2d-45aa-95c3-44788f10aad7','2026-07-06');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('8c9d67ed-b639-47e3-8997-26165196cc8e','7c219bb1-ee2d-45aa-95c3-44788f10aad7','2026-07-06','part_time','active','Service Crew','b54bb901-3790-4e55-8ab1-571768b44665','JYMT Kopitiam','admin_change');
insert into qa_payroll_population.employees values('f6f6c8f2-0af1-42bb-ab78-39f4aa9ffad0','2026-02-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('f1439522-ea8f-4b6c-a7cd-40c296ee448f','f6f6c8f2-0af1-42bb-ab78-39f4aa9ffad0','2026-02-13','part_time','active','Service Crew','b54bb901-3790-4e55-8ab1-571768b44665','JYMT Kopitiam','admin_change');
insert into qa_payroll_population.employees values('bf04246e-253c-417c-8589-f09038978c34','2026-09-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('ac48638b-4628-4cc5-ab13-349c3aa12e3e','bf04246e-253c-417c-8589-f09038978c34','2026-09-01','part_time','active','Service Crew','b54bb901-3790-4e55-8ab1-571768b44665','JYMT Kopitiam','admin_change');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('e0974cdc-227d-4ae2-a425-4c1daed2126e','bf04246e-253c-417c-8589-f09038978c34','2026-09-02','part_time','active','Service Crew','b54bb901-3790-4e55-8ab1-571768b44665','JYMT Kopitiam','admin_change');
insert into qa_payroll_population.employees values('f78c8af1-80f4-43a8-8086-8bbdfc8aa9a9','2025-06-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('170e16da-ee95-4a68-b701-1cdf7186cad7','f78c8af1-80f4-43a8-8086-8bbdfc8aa9a9','2026-07-01','full_time','active','Content Creator','b54bb901-3790-4e55-8ab1-571768b44665','Management','admin_change');
insert into qa_payroll_population.employees values('06631c05-12a2-4eb3-b52b-d7e96407140b','2026-03-09');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('bf4364e8-0838-48c5-b9bf-ca88ada30fc1','06631c05-12a2-4eb3-b52b-d7e96407140b','2026-03-09','part_time','active','Service Crew','b54bb901-3790-4e55-8ab1-571768b44665','JYMT Kopitiam','admin_change');
insert into qa_payroll_population.employees values('3f8eb3e6-f13f-4125-9685-53c35fd2b556','2026-01-05');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('9b0868f5-5830-45f3-905c-229885b5d724','3f8eb3e6-f13f-4125-9685-53c35fd2b556','2026-01-05','full_time','active','Service Crew','bcd86ee3-0b72-4117-bdd4-26b59f3e3740','Happiness Kopitiam Ipoh','admin_change');
insert into qa_payroll_population.employees values('519311dd-3671-4c99-b1c2-b3c1cfdd6d79','2026-01-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('3cc7545d-7621-494e-bc4f-bc8719d54811','519311dd-3671-4c99-b1c2-b3c1cfdd6d79','2026-01-01','probation','active','Service Crew','bcd86ee3-0b72-4117-bdd4-26b59f3e3740','Happiness Kopitiam Ipoh','admin_change');
insert into qa_payroll_population.employees values('87a80df5-696d-479d-a417-cab1c602b1b2','2023-01-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('8581a457-7edd-42fd-9d04-3f4f6f6786b9','87a80df5-696d-479d-a417-cab1c602b1b2','2026-05-01','contract','active','Head Chef','adba905b-954b-4965-93dd-efe9cc1c5536','Management','admin_change');
insert into qa_payroll_population.employees values('6cba4ada-690f-4c94-a464-b1f6d75ac427','2026-05-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('23b29817-d930-42f6-96f9-c250f5bc235b','6cba4ada-690f-4c94-a464-b1f6d75ac427','2026-05-01','full_time','active','Brand Manager','adba905b-954b-4965-93dd-efe9cc1c5536','Management','admin_change');
insert into qa_payroll_population.employees values('39d8af6b-7c8a-42e8-8e69-5c00f8edbcbc','2026-01-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('1a8666f6-876b-4ece-bbd8-54f261591abe','39d8af6b-7c8a-42e8-8e69-5c00f8edbcbc','2026-05-01','part_time','active','Service Crew','adba905b-954b-4965-93dd-efe9cc1c5536','Hola Hola Kopitiam Ipoh','admin_change');
insert into qa_payroll_population.employees values('e01dfffe-cb1b-44d6-aa64-fd33a7ce673c','2026-02-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('c36729da-8084-4ba8-80ad-068438c03004','e01dfffe-cb1b-44d6-aa64-fd33a7ce673c','2026-06-01','part_time','active','Service Crew','adba905b-954b-4965-93dd-efe9cc1c5536','Hola Hola Kopitiam Ipoh','admin_change');
insert into qa_payroll_population.employees values('46259920-f2ab-45a1-8975-3234c2493267','2023-01-01');
insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,workplace,source_kind) values('b4787163-0272-4e03-89a1-1dffdcd28639','46259920-f2ab-45a1-8975-3234c2493267','2026-05-01','full_time','active','Operations Manager','adba905b-954b-4965-93dd-efe9cc1c5536','Management','admin_change');

do $qa$
declare p record; n integer;
begin
 for p in select id from qa_payroll_population.payroll_periods loop
   if qa_payroll_population.payroll_period_employment_scope_issue(p.id) is not null then raise exception 'Complete September population blocked: %',p.id; end if;
 end loop;
 -- Unknown non-member with a later known employer: no backward inference.
 insert into qa_payroll_population.employees values('00000000-0000-0000-0000-000000000001','2026-09-01');
 insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_status,legal_entity_id,source_kind)
 values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','2026-09-29','active','bcd86ee3-0b72-4117-bdd4-26b59f3e3740','cutover_current');
 for p in select id from qa_payroll_population.payroll_periods loop
   select count(*) into n from qa_payroll_population.payroll_period_population_gaps(p.id) where employee_id='00000000-0000-0000-0000-000000000001' and date_from='2026-09-01' and date_to='2026-09-28' and missing_field='employment_assignment';
   if n<>1 then raise exception 'Unknown non-member must block every potentially affected entity'; end if;
 end loop;
 insert into qa_payroll_population.employee_employment_assignment_revisions(id,employee_id,effective_from,employment_status,legal_entity_id,source_kind,corrects_revision_id)
 values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','2026-09-01','active','bcd86ee3-0b72-4117-bdd4-26b59f3e3740','admin_change','00000000-0000-0000-0000-000000000002');
 for p in select id from qa_payroll_population.payroll_periods loop
   if qa_payroll_population.payroll_period_employment_scope_issue(p.id) is not null then raise exception 'Historical correction failed to clear actual gap'; end if;
 end loop;
 -- Missing employer remains unknown for all entities, even outside current members.
 update qa_payroll_population.employee_employment_assignment_revisions set legal_entity_id=null where id='00000000-0000-0000-0000-000000000003';
 for p in select id from qa_payroll_population.payroll_periods loop
   if not exists(select 1 from qa_payroll_population.payroll_period_population_gaps(p.id) where missing_field='legal_entity_id' and date_from='2026-09-01' and date_to='2026-09-30') then raise exception 'Missing employer bypassed'; end if;
 end loop;
 update qa_payroll_population.employee_employment_assignment_revisions set legal_entity_id='bcd86ee3-0b72-4117-bdd4-26b59f3e3740' where id='00000000-0000-0000-0000-000000000003';
 update qa_payroll_population.employees set joined_date=null where id='00000000-0000-0000-0000-000000000001';
 for p in select * from qa_payroll_population.payroll_periods loop
   if (qa_payroll_population.payroll_period_employment_scope_issue(p.id) is not null) <> (p.legal_entity_id='bcd86ee3-0b72-4117-bdd4-26b59f3e3740') then raise exception 'Joined-date scope exclusion wrong'; end if;
 end loop;
 -- Verified inactive state establishes exclusion, not today's mutable status.
 update qa_payroll_population.employee_employment_assignment_revisions set employment_status='resigned' where id='00000000-0000-0000-0000-000000000003';
 for p in select id from qa_payroll_population.payroll_periods loop
   if qa_payroll_population.payroll_period_employment_scope_issue(p.id) is not null then raise exception 'Verified inactive dates blocked'; end if;
 end loop;
end $qa$;
select 'PASS: four complete September populations; unknown non-member; employer; Joined Date; inactive exclusion; corrected cutover' as result;
rollback;
