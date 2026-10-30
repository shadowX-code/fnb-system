import { expect, it, vi } from "vitest";
import { readAdminMasters } from "../adminMasterReads.js";
it("loads only canonical outlet scope for Factory, without clearing deferred data", async () => {
 const readers = { outlets: vi.fn().mockResolvedValue(["scoped"]), suppliers: vi.fn(), salesRecords: vi.fn() };
 const result = await readAdminMasters(readers, { factoryOnly: true });
 expect(result).toEqual({ outlets: { status: "fulfilled", value: ["scoped"] }, suppliers: { status: "deferred" }, salesRecords: { status: "deferred" } });
 expect(readers.suppliers).not.toHaveBeenCalled(); expect(readers.salesRecords).not.toHaveBeenCalled();
});
it("restores independent existing readers on workspace return and retains error boundaries", async () => {
 const denied = new Error("denied");
 const result = await readAdminMasters({ outlets: async () => ["scope"], suppliers: async () => { throw denied; }, salesRecords: async () => ["records"] });
 expect(result.outlets.value).toEqual(["scope"]); expect(result.suppliers).toEqual({ status: "rejected", reason: denied }); expect(result.salesRecords.value).toEqual(["records"]);
});
