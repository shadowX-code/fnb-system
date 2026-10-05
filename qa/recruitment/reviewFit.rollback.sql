-- Focused report-version authority checks; no fixture or business data survives.
begin;
do $$
declare r recruitment_reports%rowtype;
begin
 if (select column_default from information_schema.columns where table_schema='public' and table_name='recruitment_reports' and column_name='prompt_version') not like '%recruitment-report-v3%' then raise exception 'New reports must pin v3'; end if;
 select * into r from recruitment_reports where status='ready' order by created_at limit 1;
 if r.id is null then raise exception 'Historical ready report fixture required'; end if;
 begin
   update recruitment_reports set body=body||jsonb_build_object('forbidden_revision',true) where id=r.id;
   raise exception 'Historical report was mutable';
 exception when sqlstate '55000' then null; end;
 if not exists(select 1 from recruitment_reports where id=r.id and source_hash=r.source_hash and body=r.body and prompt_version=r.prompt_version) then raise exception 'History changed'; end if;
 if has_table_privilege('anon','public.recruitment_reports','SELECT') or has_table_privilege('authenticated','public.recruitment_reports','UPDATE') then raise exception 'Direct report access exposed'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform public.recruitment_report_prepare(gen_random_uuid(),gen_random_uuid(),true); raise exception 'Anonymous report generation exposed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
