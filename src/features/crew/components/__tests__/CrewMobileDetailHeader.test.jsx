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
});
