-- Sort the complete authorized filtered read model before pagination. POS metrics retain their current source.
do $migration$
declare definition text:=pg_get_functiondef('public.marketing_customers_read(uuid,uuid,jsonb,integer,integer)'::regprocedure);
begin
 if position($old$select * from filtered order by case when p_filters->>'sort'='name_desc' then display_name end desc, case when p_filters->>'sort'='activity' then last_activity end desc nulls last,display_name,id limit lim offset (greatest(1,p_page)-1)*lim)$old$ in definition)=0 then raise exception 'Customer sort baseline differs.';end if;
 definition:=replace(definition,$old$select * from filtered order by case when p_filters->>'sort'='name_desc' then display_name end desc, case when p_filters->>'sort'='activity' then last_activity end desc nulls last,display_name,id limit lim offset (greatest(1,p_page)-1)*lim)$old$,$new$select * from (select filtered.*,row_number() over(order by
 case when p_filters->>'sort'='name_asc' then display_name end asc nulls last,
 case when p_filters->>'sort'='name_desc' then display_name end desc nulls last,
 case when p_filters->>'sort'='phone_e164_asc' then phone_e164 end asc nulls last,
 case when p_filters->>'sort'='phone_e164_desc' then phone_e164 end desc nulls last,
 case when p_filters->>'sort'='birthday_asc' then birthday end asc nulls last,
 case when p_filters->>'sort'='birthday_desc' then birthday end desc nulls last,
 case when p_filters->>'sort'='total_visit_asc' then nullif(pos_snapshot->'metrics'->>'total_visit','')::numeric end asc nulls last,
 case when p_filters->>'sort'='total_visit_desc' then nullif(pos_snapshot->'metrics'->>'total_visit','')::numeric end desc nulls last,
 case when p_filters->>'sort'='total_spent_asc' then nullif(pos_snapshot->'metrics'->>'total_spent','')::numeric end asc nulls last,
 case when p_filters->>'sort'='total_spent_desc' then nullif(pos_snapshot->'metrics'->>'total_spent','')::numeric end desc nulls last,
 case when p_filters->>'sort'='avg_spent_asc' then nullif(pos_snapshot->'metrics'->>'avg_spent','')::numeric end asc nulls last,
 case when p_filters->>'sort'='avg_spent_desc' then nullif(pos_snapshot->'metrics'->>'avg_spent','')::numeric end desc nulls last,
 case when p_filters->>'sort'='last_visit_asc' then nullif(pos_snapshot->'metrics'->>'last_visit','')::date end asc nulls last,
 case when p_filters->>'sort'='last_visit_desc' then nullif(pos_snapshot->'metrics'->>'last_visit','')::date end desc nulls last,
 case when p_filters->>'sort'='member_since_asc' then nullif(pos_snapshot->'metrics'->>'member_since','')::date end asc nulls last,
 case when p_filters->>'sort'='member_since_desc' then nullif(pos_snapshot->'metrics'->>'member_since','')::date end desc nulls last,
 case when p_filters->>'sort'='activity' then last_activity end desc nulls last,
 display_name asc nulls last,
 id) as _sort_row from filtered) ordered
 order by _sort_row limit lim offset (greatest(1,p_page)-1)*lim)$new$);
 definition:=replace(definition,'jsonb_agg(to_jsonb(page))','jsonb_agg(to_jsonb(page)-''_sort_row'' order by _sort_row)');
 execute definition;
end;$migration$;
