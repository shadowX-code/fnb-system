-- Expose the Crew employee's unread disciplinary count from the canonical
-- disciplinary projection. Delivery remains separate from explicit viewing.

create or replace function public.crew_employee_disciplinary(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_employee uuid;
  v_now timestamptz:=clock_timestamp();
  v_rows jsonb;
  v_unread_count integer;
begin
  v_employee:=public.crew_session_employee(p_token);
  with delivered as (
    update public.employee_disciplinary_warnings
    set status='delivered',delivered_at=v_now,updated_at=v_now
    where employee_id=v_employee and status='issued'
    returning id
  )
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
  select id,'delivered','system',null,v_now from delivered;

  select count(*)::integer into v_unread_count
  from public.employee_disciplinary_warnings
  where employee_id=v_employee
    and status='delivered'
    and first_viewed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,
    'display_sequence',w.display_sequence,
    'warning_type',w.warning_type,
    'subject',w.subject,
    'issued_date',w.issued_date,
    'status',w.status,
    'issued_at',w.issued_at,
    'viewed_at',w.first_viewed_at,
    'acknowledged_at',w.acknowledged_at,
    'has_response',response.id is not null
  ) order by w.display_sequence desc),'[]'::jsonb) into v_rows
  from public.employee_disciplinary_warnings w
  left join public.employee_disciplinary_responses response on response.warning_id=w.id
  where w.employee_id=v_employee and w.status<>'draft';

  return jsonb_build_object('warnings',v_rows,'unread_count',v_unread_count);
end; $$;

revoke all on function public.crew_employee_disciplinary(text) from public,anon,authenticated;
grant execute on function public.crew_employee_disciplinary(text) to anon,authenticated;
