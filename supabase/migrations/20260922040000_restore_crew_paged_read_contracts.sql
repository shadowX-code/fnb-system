-- The original paging migration was timestamped after its two corrective
-- migrations. A clean migration chain therefore applied the corrections and
-- then replaced them with the older broken function bodies. Reapply the
-- canonical server-paged contracts forward-only.

create or replace function public.crew_sop_admin_page(p_outlet_id uuid, p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_source jsonb; v_rows jsonb; v_total integer;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_query text := coalesce(p_filters->>'query', '');
  v_category_id text := coalesce(p_filters->>'category_id', '');
  v_status text := coalesce(p_filters->>'status', '');
  v_sort text := coalesce(p_filters->>'sort', 'category_asc');
begin
  v_source := public.crew_sop_admin_library(p_outlet_id);
  with rows as (select value as row from jsonb_array_elements(coalesce(v_source->'sops', '[]'::jsonb))), filtered as (
    select row from rows
    where (v_query = '' or concat_ws(' ', row->>'title', row->>'summary') ilike '%' || v_query || '%')
      and (v_category_id = '' or row->>'category_id' = v_category_id)
      and (v_status = '' or case
        when exists (select 1 from jsonb_array_elements(coalesce(row->'versions', '[]'::jsonb)) version where version->>'status' = 'draft') then 'draft'
        when exists (select 1 from jsonb_array_elements(coalesce(row->'versions', '[]'::jsonb)) version where version->>'status' = 'published') then 'published'
        else row->>'status'
      end = v_status)
  ) select count(*) into v_total from filtered;
  with rows as (select value as row from jsonb_array_elements(coalesce(v_source->'sops', '[]'::jsonb))), filtered as (
    select row from rows
    where (v_query = '' or concat_ws(' ', row->>'title', row->>'summary') ilike '%' || v_query || '%')
      and (v_category_id = '' or row->>'category_id' = v_category_id)
      and (v_status = '' or case
        when exists (select 1 from jsonb_array_elements(coalesce(row->'versions', '[]'::jsonb)) version where version->>'status' = 'draft') then 'draft'
        when exists (select 1 from jsonb_array_elements(coalesce(row->'versions', '[]'::jsonb)) version where version->>'status' = 'published') then 'published'
        else row->>'status'
      end = v_status)
  ) select coalesce(jsonb_agg(row order by
    case when v_sort = 'category_desc' then null else row->>'category' end asc,
    case when v_sort = 'category_desc' then row->>'category' end desc,
    row->>'title'
  ), '[]'::jsonb) into v_rows from (select row from filtered offset (v_page - 1) * v_size limit v_size) page_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total, 'page', v_page, 'page_size', v_size, 'summary', jsonb_build_object('categories', coalesce(v_source->'categories', '[]'::jsonb)));
end; $$;

revoke all on function public.crew_sop_admin_page(uuid, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.crew_sop_admin_page(uuid, jsonb, integer, integer) to authenticated;

create or replace function public.crew_reward_admin_page(p_outlet_id uuid, p_period date, p_cycle_id uuid, p_listing text, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_source jsonb; v_rows jsonb; v_total integer; v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=case when p_page_size in(20,50,100) then p_page_size else 20 end;
begin
 if p_listing not in ('entries','campaigns') then raise exception using errcode='22023',message='Unsupported Reward listing.'; end if;
 v_source:=public.crew_reward_admin_data(p_outlet_id,p_period,p_cycle_id);
 if p_listing='entries' then
   select jsonb_array_length(coalesce(v_source->'entries','[]'::jsonb)) into v_total;
   select coalesce(jsonb_agg(value order by value->>'employee_name'),'[]'::jsonb) into v_rows
   from (select value from jsonb_array_elements(coalesce(v_source->'entries','[]'::jsonb)) offset (v_page-1)*v_size limit v_size) x;
 else
   select jsonb_array_length(coalesce(v_source->'cycles','[]'::jsonb)) into v_total;
   select coalesce(jsonb_agg(value order by value->>'period_start' desc),'[]'::jsonb) into v_rows
   from (select value from jsonb_array_elements(coalesce(v_source->'cycles','[]'::jsonb)) offset (v_page-1)*v_size limit v_size) x;
 end if;
 return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,'summary',v_source-p_listing);
end; $$;

revoke all on function public.crew_reward_admin_page(uuid, date, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.crew_reward_admin_page(uuid, date, uuid, text, integer, integer) to authenticated;
