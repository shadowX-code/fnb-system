-- Expand the Insights object once instead of copying the full report per level.
-- Preserve exact rows, order, explicit provenance overrides and resource bounds.
do $migration$
declare f text;old text:=$old$ for k,v in select * from jsonb_each(p_report->'insights') loop
  p_report:=jsonb_set(p_report,array['insights',k],(select coalesce(jsonb_agg(case when r ? 'attribution' then r else r||jsonb_build_object('attribution',common) end order by ord),'[]') from jsonb_array_elements(v) with ordinality entries(r,ord)));
 end loop;$old$;
begin
 select pg_get_functiondef('marketing_private.ads_unpack_report(jsonb)'::regprocedure) into f;
 if position(old in f)=0 or position('octet_length(p_report::text)>3000000' in f)=0 or position('octet_length(p_report::text)>6000000' in f)=0 or position('if n>10000' in f)=0 then raise exception 'Ads expansion contract changed';end if;
 f:=replace(f,old,$new$ if p_report->'insights' is not null then
  select coalesce(jsonb_object_agg(level.key,(select coalesce(jsonb_agg(case when r ? 'attribution' then r else r||jsonb_build_object('attribution',common) end order by ord),'[]') from jsonb_array_elements(level.value) with ordinality entries(r,ord))),'{}') into v
  from jsonb_each(p_report->'insights') level;
  p_report:=jsonb_set(p_report,'{insights}',v);
 end if;$new$);
 execute f;

 -- A complete selected-period report already includes its authorized configuration.
 -- Keep the separately scoped catalog only for connections without that report.
 select pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure) into f;
 old:=$old$and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text)
 )$old$;
 if position(old in f)=0 or position('with scoped_catalog as materialized' in f)=0 then raise exception 'Ads catalog read contract changed';end if;
 f:=replace(f,old,$new$and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text)
   and not exists(select 1 from jsonb_array_elements(reports) r where r->>'connection_id'=c.id::text)
 )$new$);
 execute f;
end;$migration$;
