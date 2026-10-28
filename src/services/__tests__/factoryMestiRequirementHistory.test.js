import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: mocks }));
import { factoryService } from "../factoryService.js";
beforeEach(() => vi.clearAllMocks());

it("reads only the selected immutable lineage including superseded versions through the existing mapper", async () => {
  const rows = [{ id: "v2", logical_requirement_id: "lineage", version_no: 2, effective_from: "2026-09-20", locations: [{ location_id: "kitchen", location: { location_name: "Kitchen" } }], creator: { nickname: "Isaac" } }, { id: "v1", logical_requirement_id: "lineage", version_no: 1, effective_until: "2026-09-20", superseded_by: "v2" }];
  const before = JSON.stringify(rows);
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  mocks.from.mockReturnValue({ select });
  const result = await factoryService.listMestiCleaningRequirementVersions("lineage");
  expect(mocks.from).toHaveBeenCalledExactlyOnceWith("factory_mesti_cleaning_requirements");
  expect(eq).toHaveBeenCalledExactlyOnceWith("logical_requirement_id", "lineage");
  expect(order).toHaveBeenCalledWith("version_no", { ascending: false });
  expect(select.mock.calls[0][0]).toContain("factory_mesti_cleaning_requirement_locations");
  expect(result[0]).toMatchObject({ id: "v2", location_ids: ["kitchen"], location_names: ["Kitchen"], created_by_name: "Isaac" });
  expect(result[1]).toMatchObject({ id: "v1", effective_until: "2026-09-20", superseded_by: "v2" });
  expect(JSON.stringify(rows)).toBe(before);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("rejects absent lineage before a query and propagates denied reads", async () => {
  await expect(factoryService.listMestiCleaningRequirementVersions("")).rejects.toThrow("Select a Cleaning Requirement");
  expect(mocks.from).not.toHaveBeenCalled();
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "Permission denied", code: "42501" } }) }) }) });
  await expect(factoryService.listMestiCleaningRequirementVersions("lineage")).rejects.toThrow();
});
