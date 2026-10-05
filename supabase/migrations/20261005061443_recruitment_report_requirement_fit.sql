-- Only new report versions use requirement-fit analysis. Existing source/results remain immutable.
alter table public.recruitment_reports alter column prompt_version set default 'recruitment-report-v3';
