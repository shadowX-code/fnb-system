import { expect, it } from "vitest";
import { cleaningCalendarPresentation, cleaningOccurrenceStatus } from "../cleaningCalendarPresentation.js";
it("projects overdue pending cleaning only, using the supplied Malaysia date boundary",()=>{
 for (const source_type of ["scheduled","after_production"]) {
  const record=Object.freeze({status:"pending",due_date:"2026-10-30",source_type});
  expect(cleaningOccurrenceStatus(record,"2026-10-31")).toBe("missed");
  expect(cleaningOccurrenceStatus(record,"2026-10-30")).toBe("pending");
  expect(cleaningOccurrenceStatus(record,"2026-10-29")).toBe("pending");
  expect(record.status).toBe("pending");
 }
 for(const status of ["completed","verified","unsatisfactory","missed"]) expect(cleaningOccurrenceStatus({status,due_date:"2026-10-01"},"2026-10-31")).toBe(status);
});
it("preserves all same-day records and counts with readable aggregate statuses",()=>{
 const occurrences=Object.freeze([Object.freeze({status:"pending"}),Object.freeze({status:"verified"})]);
 expect(cleaningCalendarPresentation({due_date:"2026-10-01",total_count:2,occurrences},"2026-10-31")).toEqual({status:"missed",label:"Missed (2)",description:"Missed: 1, Verified: 1"});
 expect(occurrences[0].status).toBe("pending");
 expect(cleaningCalendarPresentation({status:"completed"},"2026-10-31").label).toBe("Completed");
});
