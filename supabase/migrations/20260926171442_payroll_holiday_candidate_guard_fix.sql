-- Event INSERT records do not have candidate source columns. Branch before
-- evaluating candidate fields; SQL expression planning is not short-circuiting.
create or replace function public.payroll_holiday_candidate_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if current_setting('feedx.holiday_candidate_command',true) is distinct from 'yes' then raise exception using errcode='42501',message='Use controlled import commands.'; end if;
 if tg_op='DELETE' then raise exception 'Import evidence is retained.'; end if;
 if tg_table_name='payroll_holiday_import_events' then
  if tg_op<>'INSERT' then raise exception 'Import events are append-only.'; end if;
  return new;
 end if;
 if tg_op='UPDATE' then
  if new.source_pdf is distinct from old.source_pdf or new.source_sha256 is distinct from old.source_sha256
   or new.source_url is distinct from old.source_url or new.source_reference is distinct from old.source_reference
   or new.is_qa is distinct from old.is_qa or new.year<>old.year or new.request_id<>old.request_id
   or new.filename<>old.filename or new.fingerprint<>old.fingerprint or new.actor_employee_id<>old.actor_employee_id or new.created_at<>old.created_at
   or (old.status in ('published','retired') and (new.status<>'retired' or new.rows<>old.rows or new.decisions<>old.decisions or new.published_calendar_id is distinct from old.published_calendar_id)) then
   raise exception 'Source and published evidence are immutable.';
  end if;
 end if;
 return new;
end $$;
