import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FactoryStatusBadge from "../FactoryStatusBadge.jsx";

describe("FactoryStatusBadge", () => {
  it("uses text-only compact badges by default with canonical status colors", () => {
    const { container } = render(<FactoryStatusBadge status="low stock">Low Stock</FactoryStatusBadge>);
    const badge = screen.getByText("Low Stock").closest(".badge");
    expect(badge.className).toContain("amber");
    expect(badge.querySelector("svg")).toBeNull();
  });

  it("renders exactly one semantic indicator only for emphasized operational statuses", () => {
    const { container } = render(<FactoryStatusBadge status="verified" variant="emphasized">Verified</FactoryStatusBadge>);
    const badge = screen.getByText("Verified").closest(".badge");
    expect(badge.className).toContain("emerald");
    expect(badge.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelectorAll(".badge")).toHaveLength(1);
  });

  it("normalizes lifecycle aliases without changing domain wording", () => {
    render(<><FactoryStatusBadge status="awaiting_verification">Awaiting Verification</FactoryStatusBadge><FactoryStatusBadge status="out_of_stock">Out of Stock</FactoryStatusBadge><FactoryStatusBadge status="released">Released</FactoryStatusBadge><FactoryStatusBadge status="cancelled">Cancelled</FactoryStatusBadge></>);
    expect(screen.getByText("Awaiting Verification").closest(".badge").className).toContain("amber");
    expect(screen.getByText("Out of Stock").closest(".badge").className).toContain("rose");
    expect(screen.getByText("Released").closest(".badge").className).toContain("blue");
    expect(screen.getByText("Cancelled").closest(".badge").className).toContain("slate");
  });
});
