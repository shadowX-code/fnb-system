import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captured: null, service: { listFactoryListingPage: vi.fn(() => Promise.resolve({ rows: [], summary: {}, total: 0 })), listProductMovementsPage: vi.fn(() => Promise.resolve({ rows: [], summary: {}, total: 0 })) } }));
vi.mock("../../../../services/factoryService.js", () => ({ factoryService: mocks.service }));
vi.mock("../../components/FactoryPagination.jsx", () => ({ useFactoryPagedQuery: (config) => { mocks.captured = config; return [{ rows: [], summary: {}, hasLoaded: true, errorKind: "", loading: false }, { clearForPermission: vi.fn(), retry: vi.fn(), requestPage: vi.fn(), requestPageSize: vi.fn() }]; } }));
vi.mock("../useFactoryPermissions.js", () => ({ default: () => ({ can: () => true, permissionSet: ["factory_raw_material_movements.view"] }) }));

import useRawMaterialMovementsQuery from "../useRawMaterialMovementsQuery.js";
import useProductMovementsQuery from "../useProductMovementsQuery.js";
import useBatchTraceabilityQuery from "../useBatchTraceabilityQuery.js";
import useFactoryAuditTrailQuery from "../useFactoryAuditTrailQuery.js";

describe("Factory extracted query contracts", () => {
  beforeEach(() => { mocks.captured = null; vi.clearAllMocks(); });
  it("maps Raw Material filters and exact batch IDs into the listing service", () => {
    const { result, rerender } = renderHook(() => useRawMaterialMovementsQuery({})); act(() => result.current.updateFilters({ search: "PB01", dateFrom: "2026-08-01" })); act(() => result.current.selectBatch({ batch_id: "batch-1", internal_batch_no: "RM-A" })); rerender();
    return mocks.captured.loadPage({ page: 2, pageSize: 50 }).then(() => expect(mocks.service.listFactoryListingPage).toHaveBeenCalledWith({ listing: "raw-movements", page: 2, pageSize: 50, filters: expect.objectContaining({ search: "PB01", dateFrom: "2026-08-01", batchId: "batch-1", batchLabel: "RM-A" }) }));
  });
  it("maps Product, Batch Traceability, and Audit filters to their existing service contracts", async () => {
    const product = renderHook(() => useProductMovementsQuery({})); act(() => product.result.current.updateFilters({ product: "sku-1", dateTo: "2026-08-31" })); await mocks.captured.loadPage({ page: 1, pageSize: 20 }); expect(mocks.service.listProductMovementsPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 20, filters: expect.objectContaining({ product: "sku-1", dateTo: "2026-08-31" }) }));
    const trace = renderHook(() => useBatchTraceabilityQuery({})); act(() => trace.result.current.updateFilters({ batchNo: "PB01", search: "Sambal" })); await mocks.captured.loadPage({ page: 3, pageSize: 50 }); expect(mocks.service.listFactoryListingPage).toHaveBeenLastCalledWith(expect.objectContaining({ listing: "batch-traceability", page: 3, pageSize: 50, filters: expect.objectContaining({ batchNo: "PB01", search: "Sambal" }) }));
    const audit = renderHook(() => useFactoryAuditTrailQuery({})); act(() => audit.result.current.updateFilters({ module: "Production", action: "Completed" })); await mocks.captured.loadPage({ page: 1, pageSize: 20 }); expect(mocks.service.listFactoryListingPage).toHaveBeenLastCalledWith(expect.objectContaining({ listing: "audit-logs", filters: expect.objectContaining({ module: "Production", action: "Completed" }) }));
  });
});
