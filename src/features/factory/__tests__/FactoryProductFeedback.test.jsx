import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FactoryProductFeedbackPublic, { isPublicProductFeedbackRoute } from "../FactoryProductFeedbackPublic.jsx";
import { sambalFeedbackTemplate } from "../productFeedbackTemplate.js";

vi.mock("../../../services/factoryService.js", () => ({ factoryService: { publicProductFeedbackEntry: vi.fn(), submitPublicProductFeedback: vi.fn() } }));
import { factoryService } from "../../../services/factoryService.js";

describe("Factory Product Feedback public contract", () => {
  it("keeps the required Sambal taxonomy ordered and versionable", () => {
    expect(sambalFeedbackTemplate).toHaveLength(11);
    expect(sambalFeedbackTemplate.find((question) => question.key === "sambal_spiciness").options.map((item) => item.value)).toContain("Just right");
    expect(sambalFeedbackTemplate.find((question) => question.key === "packaging_preference").type).toBe("image_choice");
  });

  it("recognizes the opaque Factory public route", () => {
    window.history.pushState(null, "", "/feedback/product/opaque-token");
    expect(isPublicProductFeedbackRoute()).toBe(true);
  });

  it("preserves answers while moving through the one-question flow", async () => {
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Sambal", default_language: "en", questions: sambalFeedbackTemplate.slice(0, 2) } });
    render(<FactoryProductFeedbackPublic />);
    await screen.findByText("Usual spice tolerance");
    fireEvent.click(screen.getByText("Mild"));
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("How is the sambal spiciness?");
    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(screen.getByText("Mild").className).toContain("selected"));
  });
});
