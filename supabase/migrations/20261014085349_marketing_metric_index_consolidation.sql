-- The cursor index covers the complete prior history prefix; neither backs a constraint.
do $$begin
 if not exists(select 1 from pg_indexes where schemaname='public' and indexname='marketing_creator_metrics_cursor') then raise exception 'Create the cursor-covering index before removing its redundant prefix.';end if;
end;$$;
drop index public.marketing_creator_metrics_history;
