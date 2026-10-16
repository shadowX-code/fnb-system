-- Staging only. Reference expansion verifies exact evidence, not reduced counts.
begin;
set local statement_timeout='8s';
create function pg_temp.ads_unpack_reference(p jsonb) returns jsonb language plpgsql as $$
declare k text;v jsonb;common jsonb:=p->'insight_attribution';begin
 if common is null then return p;end if;
 for k,v in select * from jsonb_each(p->'insights') loop
  p:=jsonb_set(p,array['insights',k],(select coalesce(jsonb_agg(case when r ? 'attribution' then r else r||jsonb_build_object('attribution',common) end order by ord),'[]') from jsonb_array_elements(v) with ordinality entries(r,ord)));
 end loop;
 return p-'insight_attribution';
end;$$;
do $$declare s record;r jsonb;bad jsonb;begin
 for s in select payload from marketing_private.ads_snapshots order by octet_length(payload::text) desc limit 2 loop
  r:=marketing_private.ads_unpack_report(s.payload);
  assert r=pg_temp.ads_unpack_reference(s.payload),'Complete row/provenance/order mismatch';
 end loop;
 r:='{"insight_attribution":"Provider provenance","insights":{"daily":[{"metrics":{"spend":{"value":0}}},{"attribution":"Explicit override","metrics":{"spend":{"value":null}}}],"campaign":[]}}';
 assert marketing_private.ads_unpack_report(r)=pg_temp.ads_unpack_reference(r),'Zero/null or override changed';
 assert marketing_private.ads_unpack_report('{"insights":{}}')='{"insights":{}}','Legacy evidence changed';
 assert marketing_private.ads_unpack_report('{"insight_attribution":"Provider provenance"}')='{}','Missing Insights invented';
 begin perform marketing_private.ads_unpack_report(jsonb_build_object('insight_attribution','x','padding',repeat('z',3000001)));raise exception 'Packed size guard bypassed';exception when program_limit_exceeded then null;end;
 begin perform marketing_private.ads_unpack_report(jsonb_build_object('insight_attribution','x','insights',jsonb_build_object('daily',(select jsonb_agg('{}'::jsonb) from generate_series(1,10001)))));raise exception 'Row guard bypassed';exception when program_limit_exceeded then null;end;
 assert not has_function_privilege('authenticated','marketing_private.ads_unpack_report(jsonb)','execute'),'Private expansion exposed';
end;$$;
select 'passed: complete reference equality, missing/zero/null, provenance overrides, legacy, packed-size/row guards and private authority' acceptance;
rollback;
