-- Expand packed evidence with bounded native arrays, avoiding wide SRF tuplestores
-- and per-row aggregate sorts. Preserve original order, overrides and all guards.
do $migration$
declare f text;old text;
begin
 select pg_get_functiondef('marketing_private.ads_unpack_report(jsonb)'::regprocedure) into f;
 if md5(f)<>'c73f14de8a88ea8960696f6fe3319217' then raise exception 'Ads expansion contract changed';end if;
 old:='declare k text;v jsonb;common jsonb:=p_report->''insight_attribution'';n integer;';
 f:=replace(f,old,$new$declare k text;v jsonb;common jsonb:=p_report->'insight_attribution';n integer;
 source_insights jsonb;source_rows jsonb;entry jsonb;provenance jsonb;
 expanded_rows jsonb[];level_keys text[]:=array[]::text[];level_values jsonb[]:=array[]::jsonb[];i integer;$new$);
 old:=$old$ select coalesce(sum(jsonb_array_length(value)),0) into n from jsonb_each(p_report->'insights');$old$;
 if position(old in f)=0 then raise exception 'Ads expansion row guard changed';end if;
 f:=replace(f,old,$new$ source_insights:=p_report->'insights';
 select coalesce(sum(jsonb_array_length(source_insights->key)),0) into n from jsonb_object_keys(source_insights) as keys(key);$new$);
 old:=$old$ if p_report->'insights' is not null then
  select coalesce(jsonb_object_agg(level.key,(select coalesce(jsonb_agg(case when r ? 'attribution' then r else r||jsonb_build_object('attribution',common) end order by ord),'[]') from jsonb_array_elements(level.value) with ordinality entries(r,ord))),'{}') into v
  from jsonb_each(p_report->'insights') level;
  p_report:=jsonb_set(p_report,'{insights}',v);
 end if;$old$;
 if position(old in f)=0 then raise exception 'Ads expansion array contract changed';end if;
 f:=replace(f,old,$new$ if source_insights is not null then
  provenance:=jsonb_build_object('attribution',common);
  for k in select jsonb_object_keys(source_insights) loop
   source_rows:=source_insights->k;
   expanded_rows:=array[]::jsonb[];
   for i in 0..jsonb_array_length(source_rows)-1 loop
    entry:=source_rows->i;
    expanded_rows:=array_append(expanded_rows,case when entry ? 'attribution' then entry else entry||provenance end);
   end loop;
   level_keys:=array_append(level_keys,k);
   level_values:=array_append(level_values,to_jsonb(expanded_rows));
  end loop;
  select coalesce(jsonb_object_agg(level_keys[levels.i],level_values[levels.i]),'{}') into v from generate_subscripts(level_keys,1) as levels(i);
  p_report:=jsonb_set(p_report,'{insights}',v);
 end if;$new$);
 execute f;

 -- Iterate small keys, never materialize the expanded daily array as a SQL row.
 select pg_get_functiondef('marketing_private.ads_project(uuid,text,jsonb,uuid,boolean)'::regprocedure) into f;
 if md5(f)<>'273535adca7f73ce09616aac47b3cbb0' then raise exception 'Ads Brand projection contract changed';end if;
 old:=$old$for k,v in select * from jsonb_each(p_payload->'insights') loop$old$;
 if position(old in f)=0 then raise exception 'Ads Brand projection iteration changed';end if;
 f:=replace(f,old,$new$for k in select jsonb_object_keys(p_payload->'insights') loop
v:=p_payload#>array['insights',k];$new$);
 execute f;
end;$migration$;
