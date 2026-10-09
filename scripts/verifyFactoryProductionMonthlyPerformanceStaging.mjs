// Emits a read-only PostgreSQL regression query using the migration's actual projection.
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../supabase/migrations/20261009035944_factory_production_monthly_performance.sql", import.meta.url), "utf8");
const fixtures = `fixtures as (
  select md5(key)::uuid id, md5(job)::uuid job_order_id, status,
    start_date::date production_date, start_time::time start_time,
    end_date::date end_date, end_time::time end_time, qty::numeric actual_output_qty,
    null::numeric good_output_qty, null::numeric actual_produced_qty, null::numeric produced_quantity, uom
  from (values
    ('a','a','completed','2026-08-20','08:00','2026-08-20','09:00','10','kg'),
    ('b','b','completed','2026-08-21','08:00','2026-08-21','09:00','20','kg'),
    ('c','c','completed','2026-08-22','08:00','2026-08-22','09:00','30','kg'),
    ('d','d','completed','2026-08-23','08:00','2026-08-23','09:00','40','kg'),
    ('e','e','completed','2026-08-24','08:00','2026-08-24','09:00','50','kg'),
    ('f','f','completed','2026-08-25','08:00','2026-08-25','09:00','60','kg'),
    ('g','g','completed','2026-08-31','23:00','2026-09-01','01:00','70','kg'),
    ('g-replay','g','completed','2026-08-31','23:00','2026-09-01','01:00','70','kg'),
    ('h','h','completed','2026-09-01','08:00','2026-09-01','09:00','30000','g'),
    ('zero-duration','i','completed','2026-09-02','08:00','2026-09-02','08:00','20','kg'),
    ('non-mass','j','completed','2026-09-03','08:00','2026-09-03','09:00','10','pack'),
    ('negative-duration','k','completed','2026-09-04','10:00','2026-09-04','09:00','40','kg'),
    ('missing-duration','l','completed',null,null,'2026-09-05','09:00','50','kg'),
    ('zero-output','m','completed','2026-09-06','08:00','2026-09-06','10:00','0','kg'),
    ('missing-output','n','completed','2026-09-07','08:00','2026-09-07','10:00',null,'kg'),
    ('unattributed','o','completed','2026-09-08','08:00',null,null,'10','kg'),
    ('not-completed','p','in_progress','2026-09-01','08:00','2026-09-01','10:00','1000','kg'),
    ('next-month','q','completed','2026-10-01','08:00','2026-10-01','10:00','1000','kg')
  ) f(key,job,status,start_date,start_time,end_date,end_time,qty,uom)
),`;
const projection = sql.slice(sql.indexOf("with params"), sql.indexOf("  return result;"))
  .replace("with params", `with ${fixtures} params`)
  .replace("from public.factory_productions p", "from fixtures p")
  .replaceAll("p_month", "'2026-09-01'::date")
  .replace(" into result", "").trim().replace(/;$/, "");
console.log(`with result as (${projection}), days as (
  select value from result, jsonb_array_elements(jsonb_build_object->'days')
) select
  (select count(*) from days) = 7 as completed_days,
  (select (value->>'completed_runs')::int from days where value->>'day'='2026-09-01') = 2 as unique_jobs,
  (select (value->>'output_kg')::numeric from days where value->>'day'='2026-09-01') = 100 as midnight_and_gram_output,
  (select (value->>'jo_hours')::numeric from days where value->>'day'='2026-09-01') = 3 as summed_jo_hours,
  (select abs((value->>'moving_average_kg')::numeric - 310.0/7) < 0.000001 from days where value->>'day'='2026-09-01') as cross_month_seven_production_days,
  (select sum((value->>'productivity_output_kg')::numeric) / sum((value->>'jo_hours')::numeric) from days) = 20 as weighted_productivity,
  (select sum((value->>'invalid_duration_runs')::int) from days) = 3 as invalid_durations_excluded,
  (select sum((value->>'missing_output_runs')::int) from days) = 2 as unsupported_or_missing_mass_excluded,
  (select (jsonb_build_object->>'unattributed_runs')::int from result) = 1 as missing_end_not_fabricated,
  public.factory_production_operational_completion_at('2026-09-01','00:30') = '2026-08-31 16:30+00'::timestamptz as malaysia_boundary;
`);
