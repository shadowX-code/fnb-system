import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CrewMobileDetailHeader from "../CrewMobileDetailHeader.jsx";

describe("CrewMobileDetailHeader", () => {
  it("keeps the circular Back control separate from a long two-line navigation title", () => {
    const onBack = vi.fn();
    const title = "Customer Complaint Handling & Service Recovery Standard for International Guest Experience";
    const { container } = render(<CrewMobileDetailHeader title={title} onBack={onBack} />);

    const header = container.querySelector(".crew-mobile-detail-header");
    expect(header?.classList.contains("crew-v2-page-header")).toBe(true);
    expect(screen.getByRole("heading", { name: title }).getAttribute("title")).toBe(title);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("supports a route-owned trailing action without creating a second header", () => {
    const { container } = render(<CrewMobileDetailHeader title="My Schedule" onBack={vi.fn()} action={<button type="button">Today</button>} />);

    expect(container.querySelectorAll(".crew-mobile-detail-header")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });
});
