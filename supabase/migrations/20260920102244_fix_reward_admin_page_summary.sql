-- Fix the paged Reward response summary projection. The first paging migration
-- referred to an undeclared local name instead of the RPC listing parameter.
create or replace function public.crew_reward_admin_page(p_outlet_id uuid,p_period date,p_cycle_id uuid,p_listing text,p_page integer default 1,p_page_size integer default 20)
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
