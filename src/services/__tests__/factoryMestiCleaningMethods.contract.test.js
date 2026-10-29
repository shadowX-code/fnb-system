import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
const sql=readFileSync("supabase/migrations/20261029045856_factory_mesti_cleaning_methods.sql","utf8");
it("defines exactly the supplied fixed methods without chemical-use parameters",()=>{
 const catalog=JSON.parse(sql.match(/select '(\[.*\])'::jsonb/)[1]);
 expect(catalog.map(x=>x.name)).toEqual(["Cleaning","Sanitization","Clean-in-Place"]);
 expect(catalog.map(x=>x.materials)).toEqual([["Water","Detergent"],["Hot Water","Sanitizing Agent"],["Warm Water","Specialized Cleaning Chemical"]]);
 expect(catalog.every(x=>x.verification==="Visual Inspection"&&x.reference_only)).toBe(true);
 expect(catalog[2].steps).toEqual(["Circulate warm water","Circulate cleaning chemical","Drain cleaning solution","Rinse with cold water"]);
});
it("qualifies Equipment binding validation without changing its active-Equipment authority",()=>{
 const correction=readFileSync("supabase/migrations/20261029052151_factory_mesti_equipment_cleaning_binding_guard.sql","utf8");
 expect(correction).toContain("as selected(equipment_id)");
 expect(correction).toContain("equipment.id = selected.equipment_id and equipment.status = ''active''");
 expect(correction).toContain("execute replace(definition, old_guard, new_guard)");
 expect(correction).toContain("md5(definition)");
});
it("preserves unspecified legacy lineages without allowing specified methods to be cleared",()=>{
 const compatibility=readFileSync("supabase/migrations/20261029052739_factory_mesti_cleaning_legacy_version_compatibility.sql","utf8");
 expect(compatibility).toContain("coalesce(bool_and(cleaning_method is null), false)");
 expect(compatibility).toContain("A specified Cleaning Method cannot be cleared.");
 expect(compatibility).toContain("Select one Cleaning Method.");
 expect(compatibility).not.toMatch(/update public\./i);
});
it("preserves nullable legacy data while validating/versioning new method intent and snapshotting references",()=>{
 expect(sql).toContain("v_current.cleaning_method is not distinct from v_method");
 expect(sql).toContain("v_method_reference := case when");
 expect(sql).toContain("'cleaning_method_reference', p_requirement.cleaning_method_reference");
 expect(sql).toContain("'cleaning_method_reference',requirement.cleaning_method_reference");
 expect(sql).toContain("occurrence_rows.requirement_snapshot->'cleaning_method_reference'");
 expect(sql).toContain("Select one Cleaning Method.");
 expect(sql).not.toMatch(/update public\.factory_mesti_\w*occurrences\s+set\s+requirement_snapshot/i);
 expect(sql).not.toMatch(/add column cleaning_method text\s+default/i);
});
