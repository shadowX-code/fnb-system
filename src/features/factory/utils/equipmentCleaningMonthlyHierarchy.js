// One occurrence per child/date cell. Duplicate same-day obligations occupy separate lanes.
export function equipmentCleaningMonthlyHierarchy(rows) {
  return rows.map(equipment => {
    const groups = new Map();
    for (const day of equipment.days || []) {
      const used = new Map();
      for (const occurrence of [...(day.occurrences || [])].sort((a,b)=>a.id.localeCompare(b.id))) {
        const source = occurrence.source_type || "scheduled";
        const lineage = source === "after_production" ? occurrence.production_id || occurrence.production_snapshot?.production_no || occurrence.id : occurrence.requirement_id || occurrence.logical_requirement_id || occurrence.task_name;
        const group = JSON.stringify([source,lineage,occurrence.task_name]);
        const lane = used.get(group) || 0;
        used.set(group,lane+1);
        const key = `${equipment.equipment_id}:${group}:${lane}`;
        if (!groups.has(key)) groups.set(key,{...equipment,matrix_key:key,task:occurrence,calendarCells:new Map()});
        groups.get(key).calendarCells.set(day.due_date,occurrence);
      }
    }
    return {...equipment,matrix_key:equipment.equipment_id,calendarCells:new Map((equipment.days || []).map(day=>[day.due_date,day])),children:[...groups.values()]};
  });
}
