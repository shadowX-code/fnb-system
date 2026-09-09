import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FactoryProductFeedbackPublic, { isPublicProductFeedbackRoute } from "../FactoryProductFeedbackPublic.jsx";
import { CampaignEditorModal, campaignSummaryCards, productFeedbackCampaignEditorState } from "../pages/FactoryProductFeedbackPage.jsx";
import { sambalFeedbackTemplate } from "../productFeedbackTemplate.js";

vi.mock("../../../services/factoryService.js", () => ({ factoryService: { publicProductFeedbackEntry: vi.fn(), submitPublicProductFeedback: vi.fn(), uploadProductFeedbackImage: vi.fn() } }));
import { factoryService } from "../../../services/factoryService.js";

describe("Factory Product Feedback public contract", () => {
  afterEach(() => cleanup());
  it("keeps the required Sambal taxonomy ordered and versionable", () => {
    expect(sambalFeedbackTemplate).toHaveLength(11);
    expect(sambalFeedbackTemplate.find((question) => question.key === "sambal_spiciness").options.map((item) => item.value)).toContain("Just right");
    expect(sambalFeedbackTemplate.find((question) => question.key === "sambal_spiciness").options.find((item) => item.value === "Just right")).toMatchObject({ label_zh: "刚刚好", label_ms: "Sesuai" });
    expect(sambalFeedbackTemplate.find((question) => question.key === "packaging_preference").type).toBe("image_choice");
    expect(sambalFeedbackTemplate.find((question) => question.key === "overall_rating").analytics_role).toBe("overall_rating");
    expect(sambalFeedbackTemplate.find((question) => question.key === "price_20g").options[0]).toMatchObject({ amount: 0.8, currency: "MYR", display_label: "RM0.80" });
  });

  it("renders only the campaign's canonical role-driven KPI cards", () => {
    const cards = campaignSummaryCards({ responses: 3, kpis: [{ role: "overall_rating", question_key: "overall_rating", label: "Overall Rating", value: "4.5", tone: "success" }] });
    expect(cards.map((item) => item.label)).toEqual(["Responses", "Overall Rating"]);
    expect(campaignSummaryCards({ responses: 0, kpis: [] })).toEqual([expect.objectContaining({ label: "Responses", value: 0 })]);
  });

  it("recognizes the opaque Factory public route", () => {
    window.history.pushState(null, "", "/feedback/product/opaque-token");
    expect(isPublicProductFeedbackRoute()).toBe(true);
  });

  it("keeps persisted branding and localized content intact when reopening an existing campaign", () => {
    const campaign = {
      id: "campaign-1",
      name: "Sambal",
      questions: sambalFeedbackTemplate,
      content: { title: { en: "Sambal tasting", zh: "参巴试吃" }, description: { en: "Short form", ms: "Borang ringkas" } },
      branding: { logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/hero.webp", thank_you_image_url: "https://cdn.example/thanks.webp", primary_color: "#137a44", accent_color: "#1863a8" },
    };
    const reopened = productFeedbackCampaignEditorState(campaign);
    expect(reopened.branding).toEqual(campaign.branding);
    expect(reopened.content.title).toMatchObject(campaign.content.title);
    expect(reopened.content.description).toMatchObject(campaign.content.description);
    expect(reopened.questions).toEqual(sambalFeedbackTemplate);
  });

  it("preserves an explicit image removal in the campaign editor payload", () => {
    const form = productFeedbackCampaignEditorState({ name: "Sambal", branding: { logo_url: null, hero_url: "https://cdn.example/hero.webp" } });
    expect(form.branding.logo_url).toBeNull();
    expect(form.branding.hero_url).toBe("https://cdn.example/hero.webp");
  });

  it("uses previews rather than storage URLs and saves branding with unrelated edits", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<CampaignEditorModal campaign={{ id: "campaign-1", name: "Sambal", questions: sambalFeedbackTemplate, branding: { logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/hero.webp", thank_you_image_url: "https://cdn.example/thanks.webp", primary_color: "#137a44", accent_color: "#1863a8" } }} finishedGoods={[]} onClose={vi.fn()} onSave={onSave} onNotify={vi.fn()} />);
    expect(screen.getByAltText("Logo preview")).toBeTruthy();
    expect(screen.getByAltText("Hero / poster preview")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Image URL")).toBeNull();
    fireEvent.change(screen.getAllByDisplayValue("Sambal")[0], { target: { value: "Sambal tasting" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Campaign" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Sambal tasting", branding: expect.objectContaining({ logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/hero.webp", thank_you_image_url: "https://cdn.example/thanks.webp", primary_color: "#137a44", accent_color: "#1863a8" }) })));
    expect(onSave.mock.calls[0][0].questions).toBeUndefined();
  });

  it("uploads, replaces, and removes an image through branding state", async () => {
    factoryService.uploadProductFeedbackImage.mockResolvedValue({ publicUrl: "https://cdn.example/new-logo.webp" });
    const onSave = vi.fn().mockResolvedValue({});
    render(<CampaignEditorModal campaign={{ id: "campaign-1", name: "Sambal", questions: sambalFeedbackTemplate, branding: {} }} finishedGoods={[]} onClose={vi.fn()} onSave={onSave} onNotify={vi.fn()} />);
    const file = new File(["image"], "logo.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(factoryService.uploadProductFeedbackImage).toHaveBeenCalledWith(file, expect.any(Object), "logo_url"));
    expect(screen.getByAltText("Logo preview").getAttribute("src")).toBe("https://cdn.example/new-logo.webp");
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.queryByAltText("Logo preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Campaign" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ branding: expect.objectContaining({ logo_url: null }) })));
  });

  it("shows campaign context with Question 1 and preserves answers and language", async () => {
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Sambal", default_language: "en", content: { title: { en: "Sambal tasting", zh: "参巴试吃", ms: "Rasa sambal" }, description: { en: "A short tasting form", zh: "简短试吃表", ms: "Borang rasa ringkas" } }, questions: sambalFeedbackTemplate.slice(0, 2) } });
    render(<FactoryProductFeedbackPublic />);
    await screen.findByText("Usual spice tolerance");
    expect(screen.getByText("Sambal tasting")).toBeTruthy();
    expect(screen.getByText("A short tasting form")).toBeTruthy();
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
    fireEvent.click(await screen.findByText("Mild"));
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.getByRole("heading", { name: "How is the sambal spiciness?" })).toBeTruthy();
    fireEvent.click(screen.getByText("Just right"));
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(factoryService.submitPublicProductFeedback).not.toHaveBeenCalled();
    expect(screen.getByText("Submit feedback")).toBeTruthy();
  });

  it("keeps multiple choice explicit and reports the selected count", async () => {
    const questions = [{ key: "preferences", label_en: "Choose preferences", type: "multi_choice", required: true, min_selections: 1, options: [{ value: "taste", label_en: "Taste" }, { value: "texture", label_en: "Texture" }] }, { key: "comment", label_en: "Comment", type: "short_text", required: false, options: [] }];
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Tasting", default_language: "en", questions } });
    render(<FactoryProductFeedbackPublic />);
    expect(await screen.findByText("Select one or more")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Taste" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: /Continue · 0 selected/ }).disabled).toBe(true);
    fireEvent.click(screen.getByText("Taste"));
    expect(screen.getByText("Select one or more · 1 selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Taste" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: /Continue · 1 selected/ }).disabled).toBe(false);
  });
});
