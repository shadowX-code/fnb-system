-- The original Performance paging correction was timestamped before the
-- migration that later replaced this function. Reapply the canonical final
-- definition forward-only so clean environments retain the correct JSON
-- filter parsing and server-paged response contract.

create or replace function public.crew_performance_admin_page(p_outlet_id uuid, p_period date, p_listing text, p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  v_source jsonb; v_rows jsonb; v_total integer;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_query text := coalesce(p_filters->>'query', '');
  v_position text := coalesce(p_filters->>'position', 'all');
  v_status text := coalesce(p_filters->>'status', 'all');
begin
  if p_listing not in ('review_queue', 'team') then raise exception using errcode = '22023', message = 'Unsupported Performance listing.'; end if;
  v_source := public.crew_performance_admin_data(p_outlet_id, p_period);
  with rows as (select value as row from jsonb_array_elements(coalesce(v_source->'crew', '[]'::jsonb))), filtered as (
    select row from rows
    where (v_query = '' or concat_ws(' ', row->'employee'->>'full_name', row->'employee'->>'employee_code', row->'employee'->>'position') ilike '%' || v_query || '%')
      and (v_position = 'all' or row->'employee'->>'position' = v_position)
      and (v_status = 'all'
        or (v_status = 'awaiting' and (row->'result'->'components'->'service'->>'status' <> 'reviewed' or row->'result'->'components'->'conduct'->>'status' <> 'reviewed'))
        or (v_status = 'reviewed' and row->'result'->'components'->'service'->>'status' = 'reviewed' and row->'result'->'components'->'conduct'->>'status' = 'reviewed')
        or (v_status = 'finalized' and row->'result'->>'status' = 'finalized'))
  ) select count(*) into v_total from filtered;
  with rows as (select value as row from jsonb_array_elements(coalesce(v_source->'crew', '[]'::jsonb))), filtered as (
    select row from rows
    where (v_query = '' or concat_ws(' ', row->'employee'->>'full_name', row->'employee'->>'employee_code', row->'employee'->>'position') ilike '%' || v_query || '%')
      and (v_position = 'all' or row->'employee'->>'position' = v_position)
      and (v_status = 'all'
        or (v_status = 'awaiting' and (row->'result'->'components'->'service'->>'status' <> 'reviewed' or row->'result'->'components'->'conduct'->>'status' <> 'reviewed'))
        or (v_status = 'reviewed' and row->'result'->'components'->'service'->>'status' = 'reviewed' and row->'result'->'components'->'conduct'->>'status' = 'reviewed')
        or (v_status = 'finalized' and row->'result'->>'status' = 'finalized'))
  ) select coalesce(jsonb_agg(row order by
    case when p_listing = 'review_queue' then (row->'result'->'components'->'service'->>'status' = 'reviewed' and row->'result'->'components'->'conduct'->>'status' = 'reviewed') else false end,
    row->'employee'->>'full_name'
  ), '[]'::jsonb) into v_rows from (select row from filtered offset (v_page - 1) * v_size limit v_size) page_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total, 'page', v_page, 'page_size', v_size, 'summary', jsonb_build_object('period_summary', coalesce(v_source->'summary', '{}'::jsonb), 'scoring_framework', coalesce(v_source->'scoring_framework', '[]'::jsonb)));
end; $$;

revoke all on function public.crew_performance_admin_page(uuid, date, text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.crew_performance_admin_page(uuid, date, text, jsonb, integer, integer) to authenticated;
