import { expect, it } from "vitest";
import { equipmentCleaningMonthlyHierarchy } from "../equipmentCleaningMonthlyHierarchy.js";
it("keeps scheduled tasks across days and every duplicate/production obligation in separate cells",()=>{
 const task={task_name:"Clean",source_type:"scheduled",requirement_id:"r",status:"pending"};
 const rows=[{equipment_id:"e",days:[{due_date:"2026-10-01",occurrences:[{...task,id:"a"},{...task,id:"b"},{...task,id:"p",source_type:"after_production",production_id:"p1"},{...task,id:"q",source_type:"after_production",production_id:"p2"}]},{due_date:"2026-10-02",occurrences:[{...task,id:"c"}]}]}];
 const [parent]=equipmentCleaningMonthlyHierarchy(rows);
 expect(parent.children).toHaveLength(4);
 const cells=parent.children.flatMap(row=>[...row.calendarCells.values()]);
 expect(cells.map(cell=>cell.id).sort()).toEqual(["a","b","c","p","q"]);
 expect(parent.children[0].calendarCells.size).toBe(2);
 expect(rows[0]).not.toHaveProperty("children");
});
