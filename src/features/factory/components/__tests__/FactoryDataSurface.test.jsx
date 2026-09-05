import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactoryDataSurface, FactoryTable } from "../FactoryDataDisplay.jsx";

describe("FactoryDataSurface", () => {
  it("owns the shared list boundary around an integrated FactoryTable", () => {
    const { container } = render(
      <FactoryDataSurface>
        <FactoryTable
          columns={[{ key: "name", label: "Name" }]}
          rows={[{ id: "row-1", name: "Black Pepper" }]}
        />
      </FactoryDataSurface>,
    );

    expect(container.querySelector(".factory-data-surface .factory-table")).not.toBeNull();
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Black Pepper")).toBeTruthy();
  });
});
