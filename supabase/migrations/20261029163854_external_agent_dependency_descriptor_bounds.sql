-- Dependency review needs grant descriptors, never repeated complete catalogs.
do $$declare d text;begin
 select pg_get_functiondef('feedx_integrations.resource_access_projection(uuid)'::regprocedure) into d;
 execute replace(d,'jsonb_agg(d.v order by',$descriptor$jsonb_agg((select jsonb_object_agg(key,value) from jsonb_each(d.v) where key in ('name','label','module_id','permission','granted','can_assign','implemented')) order by$descriptor$);
 select pg_get_functiondef('public.external_agents_resolve_access(uuid,text,text,text)'::regprocedure) into d;
 execute replace(d,'''supported'',true,','''supported'',(result->>''implemented'')::boolean and not exists(select 1 from jsonb_array_elements(result->''required'')r where not (r->>''implemented'')::boolean),''reason'',''A required capability is unavailable.'',');
end $$;
