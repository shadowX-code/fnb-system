import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PublicationState from "../PublicationState.jsx";
import { semanticStatusTone } from "../semanticStatus.js";

describe("PublicationState", () => {
  it("uses the lifecycle semantic contract", () => {
    const { rerender } = render(<PublicationState status="draft" version={2} />);
    expect(screen.getByText("Draft").closest(".badge").className).toContain("slate");
    rerender(<PublicationState status="published" unpublishedChanges lastPublishedLabel="14 Sep, 10:00" />);
    expect(screen.getByText("Published · Unpublished changes").closest(".badge").className).toContain("amber");
    expect(screen.getByText("Last published 14 Sep, 10:00")).toBeTruthy();
    rerender(<PublicationState status="finalized" />);
    expect(screen.getByText("Finalized").closest(".badge").className).toContain("emerald");
  });

  it("maps shared operational states consistently", () => {
    expect(semanticStatusTone("review_required")).toBe("warning");
    expect(semanticStatusTone("approved")).toBe("success");
    expect(semanticStatusTone("rejected")).toBe("danger");
    expect(semanticStatusTone("expired")).toBe("danger");
    expect(semanticStatusTone("not_applicable")).toBe("neutral");
  });
});
