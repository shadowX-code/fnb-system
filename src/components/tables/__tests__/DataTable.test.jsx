import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
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

// The opt-in markup and its stylesheet must ship together in scoped releases.
it("ships the canonical mobile stacking CSS with labeled cells and keeps scroll the default", () => {
 const {container}=render(<DataTable mobileLayout="stack" rows={[{id:"one",name:"Row",access:"Enabled"}]} getRowKey={row=>row.id} columns={[{key:"name",header:"Module"},{key:"access",header:"Access"}]}/>);
 expect(container.querySelector("table").dataset.mobileLayout).toBe("stack");
 expect([...container.querySelectorAll("tbody td")].map(cell=>cell.dataset.label)).toEqual(["Module","Access"]);
 const css=readFileSync(`${process.cwd()}/src/styles/index.css`,"utf8");
 const block=css.match(/\/\* Opt-in mobile record rows;[\s\S]*?\n\}/)?.[0] ?? "";
 expect(createHash("sha256").update(block).digest("hex")).toBe("22f20e9ff237cff882c3e7340e83dbe296ecc253599fcfb982c9d217b3359701");
 const normal=render(<DataTable rows={[]} columns={[]} getRowKey={row=>row.id}/>);
 expect(normal.container.querySelector("table").dataset.mobileLayout).toBe("scroll");
});
