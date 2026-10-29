-- A newly missing source is a new blocker only if that collection was previously readable.
do $$declare d text;begin
 select pg_get_functiondef('feedx_integrations.review_effective_diff(jsonb,text[],jsonb,jsonb)'::regprocedure) into d;
 d:=replace(d,'when exists(select 1 from jsonb_array_elements(missing_after)d where not exists(select 1 from jsonb_array_elements(missing_before)b where b->>''name''=d->>''name'')) then ''new_blocker''','when missing_before=''[]''::jsonb then ''new_blocker''');execute d;
 select pg_get_functiondef('public.external_agents_review_access(uuid,text[])'::regprocedure) into d;
 d:=replace(d,'fingerprint text;begin','fingerprint text;v_diff jsonb;begin');
 d:=replace(d,' return jsonb_build_object(''changes'',changes,',' v_diff:=feedx_integrations.review_effective_diff(catalog,p_desired,changes,feedx_integrations.resource_access_projection(p_identity_id)); fingerprint:=md5(fingerprint||v_diff::text); return jsonb_build_object(''changes'',changes,');
 d:=replace(d,'''effective_diff'',feedx_integrations.review_effective_diff(catalog,p_desired,changes,feedx_integrations.resource_access_projection(p_identity_id)),','''effective_diff'',v_diff,');execute d;
end $$;
