-- The canonical worker already omits rows' identical inherited attribution.
-- Rebuilding every insight array on each packed checkpoint adds avoidable work
-- inside the existing PostgREST timeout. Keep explicit row overrides unchanged.
do $$declare f text;needle text:=' if common is null then'||chr(10)||'  -- Legacy rows';begin
 select pg_get_functiondef('marketing_private.ads_pack_report(jsonb)'::regprocedure) into f;
 if position(needle in f)=0 or position('if n>10000' in f)=0 or position('octet_length(p_report::text)>6000000' in f)=0 then raise exception 'Packed reporting contract changed';end if;
 f:=replace(f,needle,' if common is not null then
  if jsonb_typeof(common)<>''string'' or octet_length(common::text)>256 then raise exception ''Invalid advertising attribution.'';end if;
  return p_report;
 end if;
 if common is null then
  -- Legacy rows');
 execute f;
end $$;
