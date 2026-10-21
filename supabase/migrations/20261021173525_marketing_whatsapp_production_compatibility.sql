-- Compatibility only: retain FB/IG authorities and existing AI execution policy.
alter table public.marketing_connections
 add column inbox_automation_owner text not null default 'unknown' check(inbox_automation_owner in ('unknown','meta','feedx')),
 add column inbox_automation_generation integer;
