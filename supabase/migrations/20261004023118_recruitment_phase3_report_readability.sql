-- Preserve every existing report/prompt; only explicitly enqueued new versions use v2.
alter table public.recruitment_reports alter column prompt_version set default 'recruitment-report-v2';
