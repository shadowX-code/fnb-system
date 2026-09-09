import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FactoryProductFeedbackPublic, { isPublicProductFeedbackRoute } from "../FactoryProductFeedbackPublic.jsx";
import { sambalFeedbackTemplate } from "../productFeedbackTemplate.js";

vi.mock("../../../services/factoryService.js", () => ({ factoryService: { publicProductFeedbackEntry: vi.fn(), submitPublicProductFeedback: vi.fn() } }));
import { factoryService } from "../../../services/factoryService.js";

describe("Factory Product Feedback public contract", () => {
  afterEach(() => cleanup());
  it("keeps the required Sambal taxonomy ordered and versionable", () => {
    expect(sambalFeedbackTemplate).toHaveLength(11);
    expect(sambalFeedbackTemplate.find((question) => question.key === "sambal_spiciness").options.map((item) => item.value)).toContain("Just right");
    expect(sambalFeedbackTemplate.find((question) => question.key === "sambal_spiciness").options.find((item) => item.value === "Just right")).toMatchObject({ label_zh: "刚刚好", label_ms: "Sesuai" });
    expect(sambalFeedbackTemplate.find((question) => question.key === "packaging_preference").type).toBe("image_choice");
  });

  it("recognizes the opaque Factory public route", () => {
    window.history.pushState(null, "", "/feedback/product/opaque-token");
    expect(isPublicProductFeedbackRoute()).toBe(true);
  });

  it("preserves answers and language while moving through the mobile flow", async () => {
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Sambal", default_language: "en", content: { title: { en: "Sambal tasting", zh: "参巴试吃", ms: "Rasa sambal" }, intro_title: { en: "Tell us about this sambal", zh: "告诉我们您对这款参巴的看法", ms: "Beritahu kami tentang sambal ini" } }, questions: sambalFeedbackTemplate.slice(0, 2) } });
    render(<FactoryProductFeedbackPublic />);
    await screen.findByText("Start feedback");
    expect(screen.getByText("Tell us about this sambal")).toBeTruthy();
    fireEvent.click(screen.getByText("Start feedback"));
    await screen.findByText("Usual spice tolerance");
    fireEvent.click(screen.getByText("Mild"));
    await screen.findByText("How is the sambal spiciness?");
    fireEvent.click(screen.getByText("Back"));
    await screen.findByText("Mild");
    await waitFor(() => expect(screen.getByText("Mild").closest("button")?.className).toContain("selected"));
    fireEvent.click(screen.getByText("中文"));
    expect(screen.getByText("您平时能接受的辣度")).toBeTruthy();
  });

  it("auto-advances a non-final single choice but never auto-submits the final answer", async () => {
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Sambal", default_language: "en", questions: sambalFeedbackTemplate.slice(0, 2) } });
    render(<FactoryProductFeedbackPublic />);
    fireEvent.click(await screen.findByText("Start feedback"));
    fireEvent.click(await screen.findByText("Mild"));
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.getByRole("heading", { name: "How is the sambal spiciness?" })).toBeTruthy();
    fireEvent.click(screen.getByText("Just right"));
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(factoryService.submitPublicProductFeedback).not.toHaveBeenCalled();
    expect(screen.getByText("Submit feedback")).toBeTruthy();
  });
});
