import { useState } from "react";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import { FactoryOperationalJobsProvider, useFactoryOperationalJobs } from "../FactoryOperationalJobsContext.jsx";

const auth = { hasPermission: (key) => key === "factory_production.view" };
const result = { jobs: [{ id: "job-1", job_order_no: "JO-1" }], productions: [], summary: { released: 1 } };

function Consumer({ label }) {
  const model = useFactoryOperationalJobs();
  const [renders, setRenders] = useState(0);
  return <div><span>{label}:{model.jobs.length}:{renders}</span><button type="button" onClick={() => setRenders((value) => value + 1)}>Rerender {label}</button></div>;
}

function Harness() {
  const [refreshKey, setRefreshKey] = useState(0);
  return <><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh token</button><FactoryOperationalJobsProvider route="production-overview" auth={auth} refreshKey={refreshKey} onPermissionDenied={vi.fn()}><Consumer label="overview" /><Consumer label="production" /></FactoryOperationalJobsProvider></>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("FactoryOperationalJobsProvider", () => {
  it("owns one bounded operational query across consumer rerenders and refreshes once for a new token", async () => {
    const query = vi.spyOn(factoryService, "listOperationalJobOrders").mockResolvedValue(result);
    render(<Harness />);
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("overview:1:0")).not.toBeNull();
    expect(screen.getByText("production:1:0")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rerender overview" }));
    expect(screen.getByText("overview:1:1")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(query).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh token" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });
});
