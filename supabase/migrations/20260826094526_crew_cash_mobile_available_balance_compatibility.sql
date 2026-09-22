-- Preserve the historic compatibility field for in-repo consumers while the
-- Crew UI reads only the single canonical deposit balance.  The source
-- projection is renamed rather than copied so its audited implementation
-- remains the sole producer of all other mobile data.
alter function public.crew_cash_mobile(text,date) rename to crew_cash_mobile_projection_source;
revoke all on function public.crew_cash_mobile_projection_source(text,date) from public,anon,authenticated;

create function public.crew_cash_mobile(
  p_token text,
  p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare payload jsonb; outlet uuid;
begin
  payload:=public.crew_cash_mobile_projection_source(p_token,p_business_date);
  outlet:=(payload->'outlet'->>'id')::uuid;
  return jsonb_set(
    payload,
    '{deposit,available_balance}',
    to_jsonb(public.crew_cash_available_balance(outlet)),
    true
  );
end;
$$;

revoke all on function public.crew_cash_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated;
