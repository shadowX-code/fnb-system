-- Provides a non-reserving Dispatch number preview and returns the authoritative
-- saved Dispatch document from the existing controlled Draft-save transaction.

create or replace function public.factory_preview_finished_good_dispatch_no(
  p_dispatch_date date
)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_prefix text := 'D' || to_char(coalesce(p_dispatch_date, current_date), 'YYMMDD');
  v_next integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to preview a Dispatch number.';
  end if;
  if not public.current_user_has_permission('factory_finished_goods_dispatch.create') then
    raise exception using errcode = '42501', message = 'Missing permission: factory_finished_goods_dispatch.create';
  end if;

  select coalesce(max(nullif(regexp_replace(dispatch.dispatch_no, '^' || v_prefix || '-', ''), '')::integer), 0) + 1
  into v_next
  from public.factory_finished_good_dispatches dispatch
  where dispatch.dispatch_no ~ ('^' || v_prefix || '-[0-9]+$');

  return v_prefix || '-' || lpad(v_next::text, 2, '0');
end;
$$;

revoke all on function public.factory_preview_finished_good_dispatch_no(date)
from public, anon;
grant execute on function public.factory_preview_finished_good_dispatch_no(date)
to authenticated;

create or replace function public.factory_save_finished_good_dispatch_draft_result(
  p_dispatch_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_reference_no text,
  p_dispatch_date date,
  p_remarks text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch_id uuid;
begin
  v_dispatch_id := public.factory_save_finished_good_dispatch_draft(
    p_dispatch_id,
    p_request_id,
    p_customer_id,
    p_reference_no,
    p_dispatch_date,
    p_remarks,
    p_items
  );

  return public.factory_get_finished_good_dispatch_result(v_dispatch_id);
end;
$$;

revoke all on function public.factory_save_finished_good_dispatch_draft_result(uuid, uuid, uuid, text, date, text, jsonb)
from public, anon;
grant execute on function public.factory_save_finished_good_dispatch_draft_result(uuid, uuid, uuid, text, date, text, jsonb)
to authenticated;
