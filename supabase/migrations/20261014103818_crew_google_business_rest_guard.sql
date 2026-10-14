-- REST sessions enforce qualified UPDATE/DELETE, even inside trusted functions.
-- Advance the reviewed authority without weakening that guard or rewriting its ledger.
do $$
declare definition text:=pg_get_functiondef('public.crew_google_business_server(text,uuid,uuid,jsonb)'::regprocedure);
 cache_delete text:='delete from google_business_private.inbox_cache;';
 oauth_delete text:='delete from google_business_private.oauth;';
 mapping_update text:='update public.crew_google_outlet_locations set revision=gen_random_uuid();';
begin
 if (length(definition)-length(replace(definition,cache_delete,'')))/length(cache_delete)<>2
  or (length(definition)-length(replace(definition,oauth_delete,'')))/length(oauth_delete)<>1
  or (length(definition)-length(replace(definition,mapping_update,'')))/length(mapping_update)<>1 then
  raise exception 'Google Business Profile authority differs from the reviewed Phase 1 baseline.';
 end if;
 definition:=replace(definition,cache_delete,'delete from google_business_private.inbox_cache where generation<=c.generation;');
 definition:=replace(definition,oauth_delete,'delete from google_business_private.oauth where generation<=c.generation;');
 definition:=replace(definition,mapping_update,'update public.crew_google_outlet_locations set revision=gen_random_uuid() where location_resource_name in (select value->>''name'' from jsonb_array_elements(p_data->''locations''));');
 execute definition;
end;$$;
