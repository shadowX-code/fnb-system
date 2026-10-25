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
 -- The accepted maximum row count preserves sequence and explicit JSON null.
 select jsonb_build_object('insight_attribution','shared','insights',jsonb_build_object('daily',jsonb_agg(jsonb_build_object('ordinal',i,'metrics',jsonb_build_object('spend',jsonb_build_object('value',case when i%2=0 then 0 else null end))) order by i),'campaign','[]'::jsonb)) into bad from generate_series(1,10000)i;
 r:=marketing_private.ads_unpack_report(bad);
 assert r=pg_temp.ads_unpack_reference(bad),'Maximum accepted rows/order changed';
 assert jsonb_array_length(r#>'{insights,daily}')=10000,'Maximum accepted report truncated';
 assert r#>>'{insights,daily,9999,ordinal}'='10000','Final row missing';
 bad:='{"insight_attribution":"shared","insights":{"daily":[{"attribution":null},{"attribution":"explicit"},{"metrics":{"value":null}}],"campaign":[]}}';
 assert marketing_private.ads_unpack_report(bad)=pg_temp.ads_unpack_reference(bad),'Explicit null provenance changed';
 assert marketing_private.ads_unpack_report('{"insight_attribution":"shared","insights":{}}')='{"insights":{}}','Empty object changed';
 begin perform marketing_private.ads_unpack_report(jsonb_build_object('insight_attribution',repeat('x',257)));raise exception 'Provenance size guard bypassed';exception when program_limit_exceeded then null;end;
 begin perform marketing_private.ads_unpack_report('{"insight_attribution":{}}');raise exception 'Provenance type guard bypassed';exception when program_limit_exceeded then null;end;
 assert not has_function_privilege('authenticated','marketing_private.ads_unpack_report(jsonb)','execute'),'Private expansion exposed';
end;$$;
select 'passed: complete reference equality, missing/zero/null, provenance overrides, legacy, packed-size/row guards and private authority' acceptance;
rollback;
