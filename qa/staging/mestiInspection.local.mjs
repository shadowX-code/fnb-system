process.on('uncaughtException', error => { console.error(error.message); process.exit(1); });
// Run with FEEDX_PGLITE_MODULE pointing to a temporary @electric-sql/pglite install.
// All scenario mutations occur in this isolated in-memory PostgreSQL instance.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const { PGlite } = await import(process.env.FEEDX_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
await db.exec(readFileSync("qa/staging/mestiInspection.schema.sql", "utf8"));
for (const file of readdirSync("supabase/migrations").filter((name) => /factory_mesti_(readonly_integration|inspection_coverage_hardening|inspection_recompletion_state)\.sql$/.test(name)).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows = async (from = "2026-09-07", to = from) => (await db.query("select * from feedx_integrations.mesti_rows($1,$2)", [from, to])).rows.map((row) => Object.values(row)[0]);
const one = (values, module) => values.filter((row) => row.module === module);
await db.exec(`
insert into factory_storage_locations(id,location_name,status) values('${id(1)}','Test Location','active');
insert into factory_equipment(id,equipment_code,name,current_location_id,status) values('${id(2)}','EQ-01','Test Equipment','${id(1)}','active');
insert into factory_mesti_cleaning_requirements(id,logical_requirement_id,task_name,recurrence_type,recurrence_weekdays,status,effective_from,effective_until,version_no)
values('${id(3)}','${id(3)}','Old Weekly','weekly','{1}','active','2026-09-01','2026-09-08',1),
('${id(4)}','${id(3)}','New Weekly','weekly','{2}','active','2026-09-08',null,2);
insert into factory_mesti_cleaning_requirement_locations values('${id(3)}','${id(1)}'),('${id(4)}','${id(1)}');
`);
let values = await rows("2026-09-07", "2026-09-09");
let area = one(values, "cleaning_of_area");
assert.equal(area.length, 2, "weekly non-due date has no invented obligation");
assert.deepEqual(area.map((row) => [row.date, row.status, row.schedule.version]), [["2026-09-07", "missing", 1], ["2026-09-08", "missing", 2]]);
assert.equal((await db.query("select count(*)::int count from factory_mesti_cleaning_occurrences")).rows[0].count, 0, "inspection never materializes occurrences");
await db.exec(`insert into factory_mesti_cleaning_occurrences(id,requirement_id,logical_requirement_id,location_id,due_date,status,requirement_snapshot)
select '${id(5)}',r.id,r.logical_requirement_id,'${id(1)}','2026-09-07','pending',factory_mesti_cleaning_occurrence_snapshot(r,l)
from factory_mesti_cleaning_requirements r cross join factory_storage_locations l where r.id='${id(3)}';`);
assert.equal(one(await rows(), "cleaning_of_area")[0].status, "overdue");
await db.exec("update factory_mesti_cleaning_occurrences set status='completed',completed_at=now(),completion_note='SENSITIVE_NOTE'");
area = one(await rows(), "cleaning_of_area")[0];
assert.equal(area.status, "awaiting_verification");
assert.equal(area.pending_verification, true);
await db.exec("update factory_mesti_cleaning_occurrences set status='verified',verified_at=now(),verification_result='verified'; update factory_mesti_cleaning_requirements set task_name='Changed current name' where version_no=1;");
area = one(await rows(), "cleaning_of_area")[0];
assert.equal(area.status, "compliant");
assert.equal(area.requirement, "Old Weekly", "issued snapshot wins over current master");
await db.exec("update factory_mesti_cleaning_occurrences set status='unsatisfactory',verification_result='unsatisfactory'");
assert.equal(one(await rows(), "cleaning_of_area")[0].status, "evidence_issues");
await db.exec("update factory_mesti_cleaning_occurrences set status='completed',completed_at=now()");
assert.equal(one(await rows(), "cleaning_of_area")[0].status, "awaiting_verification", "retained prior verification must not override a re-completed occurrence");
await db.exec(`
insert into factory_mesti_waste_disposal_requirements(id,logical_requirement_id,location_id,frequency,required_count,effective_from,status,version_no,recurrence_weekdays)
values('${id(6)}','${id(6)}','${id(1)}','weekly',2,'2026-09-01','active',1,'{1}');
insert into factory_mesti_waste_disposal_sessions(id,disposal_date,status) values('${id(7)}','2026-09-07','draft');
insert into factory_mesti_waste_disposal_events(id,session_id,location_id) values('${id(8)}','${id(7)}','${id(1)}');
`);
assert.equal(one(await rows(), "waste_disposal")[0].status, "incomplete");
await db.exec(`insert into factory_mesti_waste_disposal_events(id,session_id,location_id) values('${id(9)}','${id(7)}','${id(1)}'),('${id(10)}','${id(7)}','${id(1)}'); update factory_mesti_waste_disposal_sessions set status='submitted',submitted_at=now();`);
assert.equal(one(await rows(), "waste_disposal")[0].status, "awaiting_verification", "extra events meet count without duplicate failures");
assert.equal(one(await rows("2026-09-08"), "waste_disposal").length, 0);
await db.exec("update factory_mesti_waste_disposal_sessions set status='verified',verified_at=now()");
assert.equal(one(await rows(), "waste_disposal")[0].status, "compliant");
await db.exec(`
insert into factory_mesti_calibration_requirements(id,logical_requirement_id,equipment_id,calibration_type,interval_months,effective_from,status,version_no)
values('${id(11)}','${id(11)}','${id(2)}','Scale',1,'2026-08-01','active',1);
insert into factory_mesti_calibration_records(id,logical_requirement_id,requirement_id,equipment_id,scheduled_due_date,calibrated_date,result,status,verified_at,created_at)
values('${id(12)}','${id(11)}','${id(11)}','${id(2)}','2026-08-01','2026-08-31','pass','verified','2026-08-31T03:00:00Z','2026-08-31T02:00:00Z');
`);
let calibration = one(await rows(), "calibration")[0];
assert.equal(calibration.schedule.next_due, "2026-09-30", "canonical month arithmetic");
assert.equal(calibration.status, "not_required");
await db.exec(`insert into factory_mesti_calibration_records(id,logical_requirement_id,requirement_id,equipment_id,scheduled_due_date,calibrated_date,result,status,verified_at,created_at)
values('${id(13)}','${id(11)}','${id(11)}','${id(2)}','2026-09-30','2026-09-06','fail','verified','2026-09-06T03:00:00Z','2026-09-06T02:00:00Z');`);
calibration = one(await rows(), "calibration")[0];
assert.equal(calibration.status, "evidence_issues");
assert.equal(calibration.schedule.next_due, "2026-09-30", "verified Fail never advances validity");
await db.exec(`
insert into factory_production_sops(id,version) values('${id(14)}','v1');
insert into factory_production_sop_equipment values('${id(14)}','${id(2)}');
insert into factory_productions(id,job_order_id,production_no,status,end_date,end_time,completed_at,production_sop_id,sop_version,verification_status)
values('${id(15)}','${id(16)}','TEST-PRODUCTION','completed','2026-09-07','23:30','2026-09-08T04:00:00Z','${id(14)}','v1','awaiting_verification');
`);
values = await rows();
assert.equal(one(values, "food_processing_control")[0].evidence.qc_requirement_status, "no_qc_required");
assert.equal(one(values, "food_processing_control")[0].status, "awaiting_verification");
assert.equal(one(values, "finished_product_storage_control")[0].status, "unavailable", "missing batch evidence cannot imply compliance");
assert.equal(one(values, "cleaning_of_equipment")[0].status, "unavailable");
assert.equal(one(await rows("2026-09-08"), "food_processing_control").length, 0, "Production End wins over audit timestamp");
await db.exec(`
insert into factory_production_sop_steps(id,sop_id) values('${id(17)}','${id(14)}');
insert into factory_production_sop_step_qc_checks(id,sop_step_id,qc_type) values('${id(18)}','${id(17)}','checklist');
`);
assert.equal(one(await rows(), "food_processing_control")[0].status, "unavailable");
await db.exec(`insert into factory_production_qc_results(id,production_id,sop_qc_check_id,qc_type,checklist_result,created_at) values('${id(19)}','${id(15)}','${id(18)}','checklist','fail',now())`);
assert.equal(one(await rows(), "food_processing_control")[0].status, "evidence_issues");
await db.exec(`insert into factory_mesti_health_declarations(id,declared_at,employee_snapshot,symptoms,notes,health_status) values('${id(20)}','2026-09-06T16:30:00Z','{"employee_name":"SENSITIVE_PERSON"}','{fever}','SENSITIVE_NOTE','health_issue_declared')`);
values = await rows();
const health = one(values, "health_declaration")[0];
assert.equal(health.evidence.declaration_count, 1, "Malaysia declaration date");
assert.equal(health.status, "unavailable");
assert.equal(one(values, "operator_hygiene")[0].status, "unavailable");
assert(!JSON.stringify(values).includes("SENSITIVE_"));
assert(!JSON.stringify(health).includes("fever"));
console.log("Compliance scenarios PASS: recurrence, exclusive version boundaries, immutable snapshots, no materialization, Missing/Overdue/Pending/Fail, waste count, calibration month-end and failed renewal, Production End, pinned QC, missing storage, personnel limitations and health redaction.");
await db.close();
