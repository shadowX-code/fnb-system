import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FactoryProductFeedbackPublic, { isPublicProductFeedbackRoute } from "../FactoryProductFeedbackPublic.jsx";
import { applyCampaignBrandingAsset, CampaignEditorModal, campaignSummaryCards, productFeedbackCampaignEditorState } from "../pages/FactoryProductFeedbackPage.jsx";
import { sambalFeedbackTemplate } from "../productFeedbackTemplate.js";
import { buildProductFeedbackInsights } from "../utils/productFeedbackInsights.js";

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

  it("keeps Responses as the only universal campaign summary card", () => {
    const cards = campaignSummaryCards({ responses: 3, kpis: [{ role: "overall_rating", question_key: "overall_rating", label: "Overall Rating", value: "4.5", tone: "success" }] });
    expect(cards.map((item) => item.label)).toEqual(["Responses"]);
    expect(campaignSummaryCards({ responses: 0, kpis: [] })).toEqual([expect.objectContaining({ label: "Responses", value: 0 })]);
  });

  it("builds universal deterministic insights without Sambal-only assumptions", () => {
    const questions = [
      { key: "design", label_en: "Preferred design", type: "single_choice", options: [{ value: "A", label_en: "Design A" }, { value: "B", label_en: "Design B" }] },
      { key: "score", label_en: "Overall score", type: "rating", options: [] },
      { key: "age", label_en: "Age range", type: "single_choice", options: [{ value: "18-25", label_en: "18-25" }, { value: "26-35", label_en: "26-35" }] },
    ];
    const responses = [{ answers: { design: "A", score: "4", age: "18-25" } }, { answers: { design: "A", score: "5", age: "18-25" } }, { answers: { design: "B", score: "3", age: "26-35" } }];
    const insights = buildProductFeedbackInsights({ questions, responses });
    expect(insights.responseCount).toBe(3);
    expect(insights.questionInsights.find((item) => item.key === "design").distribution[0]).toMatchObject({ label: "Design A", percent: 67 });
    expect(insights.questionInsights.find((item) => item.key === "score")).toMatchObject({ average: 4 });
    expect(insights.segments).toEqual([]);
    expect(insights.sampleNote).toContain("Directional only");
  });

  it("supports multi-select and price aggregates while leaving no-response campaigns empty", () => {
    const questions = [
      { key: "features", label_en: "Useful features", type: "multi_choice", options: [{ value: "taste", label_en: "Taste" }, { value: "speed", label_en: "Speed" }] },
      { key: "price", label_en: "Accepted price", type: "price_choice", options: [{ value: "low", label_en: "RM1", amount: 1, currency: "MYR" }, { value: "high", label_en: "RM2", amount: 2, currency: "MYR" }] },
    ];
    const insights = buildProductFeedbackInsights({ questions, responses: [{ answers: { features: ["taste", "speed"], price: "low" } }, { answers: { features: ["taste"], price: "high" } }] });
    expect(insights.questionInsights.find((item) => item.key === "features").distribution[0]).toMatchObject({ label: "Taste", count: 2 });
    expect(insights.questionInsights.find((item) => item.key === "price")).toMatchObject({ average: 1.5, currency: "MYR" });
    expect(buildProductFeedbackInsights({ questions, responses: [] }).questionInsights).toEqual([]);
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

  it("updates only the requested branding asset and rejects malformed upload results", () => {
    const form = { name: "Sambal", content: { title: { en: "Sambal" } }, questions: sambalFeedbackTemplate, branding: { logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/hero.webp" } };
    expect(applyCampaignBrandingAsset(form, "hero_url", "https://cdn.example/new-hero.webp")).toEqual(expect.objectContaining({
      content: form.content,
      questions: form.questions,
      branding: { logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/new-hero.webp" },
    }));
    expect(() => applyCampaignBrandingAsset(form, "hero_url", "")).toThrow("usable asset");
    expect(() => applyCampaignBrandingAsset(form, "unexpected", "https://cdn.example/image.webp")).toThrow("Unsupported");
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

  it("keeps logo, hero, and thank-you previews in bounded variant containers", () => {
    render(<CampaignEditorModal campaign={{ id: "campaign-1", name: "Sambal", questions: sambalFeedbackTemplate, branding: { logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/hero.webp", thank_you_image_url: "https://cdn.example/thanks.webp" } }} finishedGoods={[]} onClose={vi.fn()} onSave={vi.fn()} onNotify={vi.fn()} />);
    expect(screen.getByAltText("Logo preview").closest("[data-preview-kind]")?.getAttribute("data-preview-kind")).toBe("logo");
    expect(screen.getByAltText("Hero / poster preview").closest("[data-preview-kind]")?.getAttribute("data-preview-kind")).toBe("hero");
    expect(screen.getByAltText("Thank-you artwork preview").closest("[data-preview-kind]")?.getAttribute("data-preview-kind")).toBe("thank-you");
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("factory-product-feedback-campaign-modal");
    // The modal shell must never become the scrolling ancestor of a hidden file input.
    expect(dialog.className).toContain("overflow-clip");
    expect(dialog.className).not.toContain("overflow-hidden");
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

  it("keeps form state and prior assets intact across failed and repeated replacements", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    const onNotify = vi.fn();
    factoryService.uploadProductFeedbackImage
      .mockRejectedValueOnce(new Error("Upload unavailable"))
      .mockResolvedValueOnce({ publicUrl: "https://cdn.example/hero-v2.webp" })
      .mockResolvedValueOnce({ publicUrl: "https://cdn.example/hero-v3.webp" });
    render(<CampaignEditorModal campaign={{ id: "campaign-1", name: "Sambal", questions: sambalFeedbackTemplate, branding: { logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/hero-v1.webp", thank_you_image_url: "https://cdn.example/thanks.webp" } }} finishedGoods={[]} onClose={vi.fn()} onSave={onSave} onNotify={onNotify} />);
    const inputs = () => [...document.querySelectorAll('input[type="file"]')];
    const first = new File(["first"], "hero-one.png", { type: "image/png" });
    fireEvent.change(inputs()[1], { target: { files: [first] } });
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({ title: "Image upload failed" })));
    expect(screen.getByAltText("Hero / poster preview").getAttribute("src")).toBe("https://cdn.example/hero-v1.webp");
    fireEvent.change(inputs()[1], { target: { files: [new File(["second"], "hero-two.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByAltText("Hero / poster preview").getAttribute("src")).toBe("https://cdn.example/hero-v2.webp"));
    fireEvent.change(inputs()[1], { target: { files: [new File(["third"], "hero-three.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByAltText("Hero / poster preview").getAttribute("src")).toBe("https://cdn.example/hero-v3.webp"));
    expect(screen.getByAltText("Logo preview").getAttribute("src")).toBe("https://cdn.example/logo.webp");
    expect(screen.getByAltText("Thank-you artwork preview").getAttribute("src")).toBe("https://cdn.example/thanks.webp");
    fireEvent.click(screen.getByRole("button", { name: "Save Campaign" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ branding: expect.objectContaining({ hero_url: "https://cdn.example/hero-v3.webp", logo_url: "https://cdn.example/logo.webp", thank_you_image_url: "https://cdn.example/thanks.webp" }) })));
  });

  it("keeps the editor mounted when an upload returns no usable public asset", async () => {
    factoryService.uploadProductFeedbackImage.mockReset();
    factoryService.uploadProductFeedbackImage.mockResolvedValue({});
    const onNotify = vi.fn();
    render(<CampaignEditorModal campaign={{ id: "campaign-1", name: "Sambal", questions: sambalFeedbackTemplate, branding: { logo_url: "https://cdn.example/logo.webp", hero_url: "https://cdn.example/hero.webp" } }} finishedGoods={[]} onClose={vi.fn()} onSave={vi.fn()} onNotify={onNotify} />);

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(["image"], "invalid-result.png", { type: "image/png" })] } });

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({ title: "Image upload failed", message: "Image upload did not return a usable asset." })));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Campaign name").value).toBe("Sambal");
    expect(screen.getByAltText("Logo preview").getAttribute("src")).toBe("https://cdn.example/logo.webp");
    expect(screen.getByAltText("Hero / poster preview").getAttribute("src")).toBe("https://cdn.example/hero.webp");
    expect(screen.getByRole("button", { name: "Save Campaign" })).toBeTruthy();
  });

  it("uses compact campaign sections and shared date controls without reviving the retired intro fields", () => {
    render(<CampaignEditorModal campaign={{ id: "campaign-1", name: "Sambal", questions: sambalFeedbackTemplate, content: { intro_title: { en: "Legacy cover" }, intro_body: { en: "Legacy copy" } } }} finishedGoods={[]} onClose={vi.fn()} onSave={vi.fn()} onNotify={vi.fn()} />);
    expect(screen.getByText("Campaign Details")).toBeTruthy();
    expect(screen.getByText("Schedule")).toBeTruthy();
    expect(screen.getByText("Public Content")).toBeTruthy();
    expect(screen.getByText("Campaign Branding")).toBeTruthy();
    expect(screen.getByText("Internal name for Admin management.")).toBeTruthy();
    expect(screen.getByText("Shown to customers on the feedback form.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Select date" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Translate Missing" })).toBeTruthy();
    expect(screen.queryByText("Intro title")).toBeNull();
    expect(screen.queryByText("Intro body")).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
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
