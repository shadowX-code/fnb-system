import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DataTable from "../DataTable.jsx";

describe("DataTable", () => {
  it("marks header, rows, and cells for the shared Admin table contract", () => {
    const { container } = render(<DataTable rows={[{ id: "row-1", name: "Friends Corner" }]} getRowKey={(row) => row.id} columns={[{ key: "name", header: "Outlet" }]} />);
    const table = container.querySelector(".admin-data-table");

    expect(table.dataset.density).toBe("normal");
    expect(table.querySelector(".admin-table-head .admin-table-header-cell")).not.toBeNull();
    expect(table.querySelector(".admin-table-row .admin-table-cell")).not.toBeNull();
  });

  it("keeps compact density explicit without changing column behavior", () => {
    const { container } = render(<DataTable density="compact" rows={[{ id: "row-1", total: "12" }]} getRowKey={(row) => row.id} columns={[{ key: "total", header: "Total", align: "right" }]} />);
    const table = container.querySelector(".admin-data-table");

    expect(table.dataset.density).toBe("compact");
    expect(table.querySelector(".admin-table-header-cell").className).toContain("text-right");
    expect(table.querySelector(".admin-table-cell").className).toContain("text-right");
  });
});

it("supports semantic secondary columns and explicit minimum width without changing default tables",()=>{
 const {container}=render(<DataTable minWidth="100%" density="compact" rows={[{id:"a"}]} getRowKey={r=>r.id} columns={[{key:"identity",header:"Candidate"},{key:"metadata",header:"Invitation",priority:"secondary"}]}/>);
 expect(container.querySelector("table").style.minWidth).toBe("100%");expect(container.querySelectorAll('[data-priority="secondary"]')).toHaveLength(2);
});
