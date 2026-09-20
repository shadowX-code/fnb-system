import { render, screen } from "@testing-library/react";
import { AlertTriangle, Users } from "lucide-react";
import { describe, expect, it } from "vitest";
import AdminSummaryGrid from "../AdminSummaryGrid.jsx";

describe("AdminSummaryGrid", () => {
  it("uses the standard four-column summary grammar without tinting an alert card", () => {
    const { container } = render(<AdminSummaryGrid ariaLabel="Feedback summary" items={[
      { label: "Total Feedback", value: 18, helper: "Selected period", icon: Users },
      { label: "Trust Review", value: 2, helper: "Requires a decision", icon: AlertTriangle, tone: "warning" },
      { label: "Great Experience", value: "82%", helper: "All scopes" },
      { label: "Excluded", value: 1, helper: "Evidence retained" },
    ]} />);

    const grid = container.querySelector('[data-admin-summary-grid="standard"]');
    const warningCard = screen.getByText("Trust Review").closest("[data-admin-summary-card]");
    expect(grid.className).toContain("xl:grid-cols-4");
    expect(warningCard.className).toContain("bg-white");
    expect(warningCard.className).not.toContain("bg-amber-50/20");
  });

  it("uses a compact five-metric layout for dense summaries", () => {
    const { container } = render(<AdminSummaryGrid variant="compact" items={[
      { label: "Modules", value: 4 }, { label: "Lessons", value: 12 }, { label: "Completion", value: "64%" }, { label: "Crew started", value: 8 }, { label: "Crew completed", value: 3 },
    ]} />);

    const grid = container.querySelector('[data-admin-summary-grid="compact"]');
    expect(grid.className).toContain("xl:grid-cols-5");
    expect(container.querySelectorAll("[data-admin-summary-card]")).toHaveLength(5);
  });
});
