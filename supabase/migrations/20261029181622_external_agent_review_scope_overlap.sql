-- Parenthesize both JSON operands before testing scope containment.
do $$declare d text;begin
 select pg_get_functiondef('feedx_integrations.review_effective_diff(jsonb,text[],jsonb,jsonb)'::regprocedure) into d;
 execute replace(d,'b->''row_scope'' @> af->''row_scope'' or af->''row_scope'' @> b->''row_scope''','(b->''row_scope'') @> (af->''row_scope'') or (af->''row_scope'') @> (b->''row_scope'')');
end $$;
