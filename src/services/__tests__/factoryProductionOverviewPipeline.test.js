import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));

import { factoryService } from "../factoryService.js";

const released = { id: "released-job", job_order_no: "JO260923-01", status: "released", planned_date: "2026-09-23" };
const scheduled = { id: "scheduled-job", job_order_no: "JO260924-01", status: "planned", planned_date: "2026-09-24" };
const inProgress = { id: "in-progress-job", job_order_no: "JO260923-03", status: "in_progress", production_date: "2026-09-23", start_time: "09:00" };
const completed = { id: "completed-job", job_order_no: "JO260923-04", status: "completed", operational_completion_at: "2026-09-23T02:00:00Z" };

describe("Factory Production Overview pipeline read model", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the bucketed pipeline snapshot so Released Job Orders remain visible", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          scheduled: [scheduled],
          released: [released],
          in_progress: [inProgress],
          completed_today: [completed],
          productions: [],
          summary: { scheduled: 1, released: 1, in_progress: 1, completed_today: 1 },
        },
        error: null,
      });

    const result = await factoryService.listOperationalJobOrders({ date: "2026-09-23", includeProductions: false });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "factory_release_due_job_orders");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "factory_get_production_operational_pipeline_snapshot", {
      p_operational_date: "2026-09-23",
      p_include_productions: false,
    });
    expect(result.jobs.map((job) => job.job_order_no)).toEqual(["JO260924-01", "JO260923-01", "JO260923-03", "JO260923-04"]);
    expect(result.summary).toMatchObject({ scheduled: 1, released: 1, inProgress: 1, completedToday: 1 });
  });
});
