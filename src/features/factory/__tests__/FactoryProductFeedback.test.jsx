import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FactoryProductFeedbackPublic, { isPublicProductFeedbackRoute, normalizeMalaysiaMobile, productFeedbackTokenFromLocation, ratingEndpointLabel, ratingScale, ratingScore } from "../FactoryProductFeedbackPublic.jsx";
import { applyCampaignBrandingAsset, CampaignEditorModal, campaignSummaryCards, FormBuilder, productFeedbackCampaignEditorState, productFeedbackQuestionDraft, productFeedbackTranslationMissing } from "../pages/FactoryProductFeedbackPage.jsx";
import { productFeedbackPublicUrl } from "../productFeedbackPublicUrl.js";
import { sambalFeedbackTemplate } from "../productFeedbackTemplate.js";
import { buildProductFeedbackInsights } from "../utils/productFeedbackInsights.js";

vi.mock("../../../services/factoryService.js", () => ({ factoryService: { publicProductFeedbackEntry: vi.fn(), submitPublicProductFeedback: vi.fn(), uploadProductFeedbackImage: vi.fn(), translateProductFeedbackContent: vi.fn() } }));
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

  it("initializes a complete safe draft for every supported question type", () => {
    ["single_choice", "multi_choice", "rating", "price_choice", "short_text", "image_choice"].forEach((type) => {
      expect(productFeedbackQuestionDraft({ key: type, type }, 1)).toMatchObject({ key: type, type, options: [], order: 1 });
    });
    expect(productFeedbackQuestionDraft({ key: "legacy", type: "unknown", options: null }, 2)).toMatchObject({ key: "legacy", type: "short_text", options: [], order: 2 });
  });

  it("treats an English copy in a Chinese option field as untranslated while preserving real localized text", () => {
    expect(productFeedbackTranslationMissing("Too mild", "Too mild", "zh")).toBe(true);
    expect(productFeedbackTranslationMissing("Too mild", "太不辣", "zh")).toBe(false);
    expect(productFeedbackTranslationMissing("Too mild", "Terlalu kurang pedas", "ms")).toBe(false);
    expect(productFeedbackTranslationMissing("RM1.00", "RM1.00", "zh")).toBe(false);
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

  it("uses the dedicated Production public hostname while preserving the Staging route contract", () => {
    expect(productFeedbackPublicUrl("opaque-token", { origin: "https://os.feedx.my", hostname: "os.feedx.my" })).toBe("https://feedback.feedx.my/opaque-token");
    expect(productFeedbackPublicUrl("variant-token", { origin: "https://feedx-os.vercel.app", hostname: "feedx-os.vercel.app" })).toBe("https://feedback.feedx.my/variant-token");
    expect(productFeedbackPublicUrl("opaque-token", { origin: "https://fnb-system-staging.vercel.app", hostname: "fnb-system-staging.vercel.app" })).toBe("https://fnb-system-staging.vercel.app/feedback/product/opaque-token");
  });

  it("recognizes and resolves an opaque token on the dedicated public hostname only", () => {
    const location = { hostname: "feedback.feedx.my", pathname: "/opaque-token", hash: "" };
    expect(isPublicProductFeedbackRoute(location)).toBe(true);
    expect(productFeedbackTokenFromLocation(location)).toBe("opaque-token");
    expect(isPublicProductFeedbackRoute({ hostname: "feedback.feedx.my", pathname: "/factory_dashboard", hash: "" })).toBe(true);
    expect(productFeedbackTokenFromLocation({ hostname: "feedback.feedx.my", pathname: "/factory_dashboard", hash: "" })).toBe("factory_dashboard");
  });

  it("ignores a public campaign read that resolves after the page unmounts", async () => {
    let resolveEntry;
    factoryService.publicProductFeedbackEntry.mockReturnValueOnce(new Promise((resolve) => { resolveEntry = resolve; }));
    const view = render(<FactoryProductFeedbackPublic />);
    view.unmount();
    resolveEntry({ available: true, campaign: { default_language: "en", questions: [] } });
    await Promise.resolve();
    expect(screen.queryByText("Feedback unavailable")).toBeNull();
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
    expect(screen.getByRole("button", { name: "BM" })).toBeTruthy();
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

  it("renders rating as a numeric star control without leaking legacy option keys", async () => {
    const questions = [{ key: "overall_rating", label_en: "Overall rating", label_zh: "整体评分", label_ms: "Penilaian keseluruhan", helper_en: "Choose a score", helper_zh: "请选择评分", helper_ms: "Pilih skor", type: "rating", required: true, options: [1, 2, 3, 4, 5].map((score) => ({ value: `option_${score}`, label_en: "" })), rating_low_label_en: "Poor", rating_low_label_zh: "差", rating_low_label_ms: "Lemah", rating_high_label_en: "Excellent", rating_high_label_zh: "优秀", rating_high_label_ms: "Cemerlang" }];
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Tasting", default_language: "en", questions } });
    render(<FactoryProductFeedbackPublic />);
    await screen.findByRole("radiogroup", { name: "Overall rating" });
    expect(screen.queryByText("option_1")).toBeNull();
    expect(screen.getByText("Poor")).toBeTruthy();
    expect(screen.getByText("Excellent")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Rate 4 out of 5" }));
    expect(screen.getByText("4 / 5")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Rate 4 out of 5" }).getAttribute("aria-checked")).toBe("true");
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.getByRole("button", { name: "Submit feedback" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("4 / 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("heading", { name: "整体评分" })).toBeTruthy();
    expect(screen.getByText("差")).toBeTruthy();
    expect(screen.getByText("优秀")).toBeTruthy();
    factoryService.submitPublicProductFeedback.mockResolvedValue({ submitted: true });
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));
    await waitFor(() => expect(factoryService.submitPublicProductFeedback).toHaveBeenCalledWith(expect.objectContaining({ answers: { overall_rating: "4" } })));
  });

  it("keeps legacy rating answer keys readable while new rating choices are numeric", () => {
    expect(ratingScale({})).toBe(5);
    expect(ratingScale({ rating_scale: 9 })).toBe(5);
    expect(ratingScore("option_4")).toBe(4);
    expect(ratingScore("4")).toBe(4);
    expect(ratingScore("option_9")).toBeNull();
    expect(ratingEndpointLabel({ rating_low_label_en: "Poor", rating_low_label_zh: "差" }, "zh", "low")).toBe("差");
  });

  it("normalizes Malaysian mobile input without accepting malformed values", () => {
    expect(normalizeMalaysiaMobile("012-345 6789")).toBe("+60123456789");
    expect(normalizeMalaysiaMobile("60123456789")).toBe("+60123456789");
    expect(normalizeMalaysiaMobile("+60 12 345 6789")).toBe("+60123456789");
    expect(normalizeMalaysiaMobile("+44 20 1234 5678")).toBeNull();
  });

  it("keeps optional contact separate from answers and sends it only after the final question", async () => {
    const questions = [{ key: "taste", label_en: "Taste", type: "single_choice", required: true, options: [{ value: "good", label_en: "Good" }] }];
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Tasting", default_language: "en", contact_collection: { enabled: true, prompt: { en: "Keep me updated" } }, questions } });
    factoryService.submitPublicProductFeedback.mockResolvedValue({ submitted: true });
    render(<FactoryProductFeedbackPublic />);
    fireEvent.click(await screen.findByText("Good"));
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.getByText("Optional")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Amina" } });
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "012 345 6789" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
    await waitFor(() => expect(factoryService.submitPublicProductFeedback).toHaveBeenCalledWith(expect.objectContaining({ answers: { taste: "good" }, contact: { name: "Amina", mobile: "+60123456789" } })));
  });

  it("persists localized helper text through Save Question and reopens it unchanged", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    const campaign = {
      questions: [{ key: "taste", label_en: "Taste", label_zh: "口味", label_ms: "Rasa", helper_en: "English helper", helper_zh: "中文提示", helper_ms: "Bantuan BM", type: "single_choice", options: [{ value: "good", label_en: "Good" }] }],
    };
    render(<FormBuilder campaign={campaign} editable onSave={onSave} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    expect(screen.getByDisplayValue("English helper")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("English helper"), { target: { value: "Saved helper" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ helper_en: "Saved helper", helper_zh: "中文提示", helper_ms: "Bantuan BM" })]));
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    expect(screen.getByDisplayValue("Saved helper")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByDisplayValue("中文提示")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "BM" }));
    expect(screen.getByDisplayValue("Bantuan BM")).toBeTruthy();
  });

  it("uses compact localized rating settings without exposing generic option editing", () => {
    render(<FormBuilder campaign={{ questions: [{ key: "score", label_en: "Score", type: "rating", required: true, options: [{ value: "option_1", label_en: "option_1" }] }] }} editable onSave={vi.fn()} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    expect(screen.getByText("Rating scale")).toBeTruthy();
    expect(screen.getByText("1–5 stars")).toBeTruthy();
    expect(screen.queryByText("Options")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Poor"), { target: { value: "Poor" } });
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    fireEvent.change(screen.getByPlaceholderText("Poor"), { target: { value: "差" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  });

  it("opens a complete first-question draft from an empty form and safely supports cancel then re-add", () => {
    render(<FormBuilder campaign={{ id: "empty", questions: [] }} editable onSave={vi.fn()} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.getByRole("heading", { name: "Edit question" })).toBeTruthy();
    expect(screen.getByDisplayValue("New question")).toBeTruthy();
    expect(screen.queryByText("Options")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTitle("Edit question")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.getByRole("heading", { name: "Edit question" })).toBeTruthy();
  });

  it("removes stale selection after deleting the last question and persists a re-added first question", async () => {
    const onSave = vi.fn().mockResolvedValue({ questions: [{ key: "question_saved", label_en: "First question", type: "short_text", required: false, options: [], order: 1 }] });
    render(<FormBuilder campaign={{ id: "delete-last", questions: [{ key: "only", label_en: "Only question", type: "short_text", required: false, options: [] }] }} editable onSave={onSave} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByTitle("Edit question")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    fireEvent.change(screen.getByDisplayValue("New question"), { target: { value: "First question" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ label_en: "First question", options: [] })]));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit question" })).toBeNull());
    expect(screen.getByText("First question")).toBeTruthy();
  });

  it("wires the real Save question button to one awaited canonical mutation", async () => {
    let resolveSave;
    const onSave = vi.fn().mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    render(<FormBuilder campaign={{ questions: [{ key: "taste", label_en: "Taste", helper_en: "Before", type: "single_choice", options: [] }] }} editable onSave={onSave} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.change(screen.getByDisplayValue("Before"), { target: { value: "After" } });
    const saveButton = screen.getByRole("button", { name: "Save question" });
    expect(saveButton.type).toBe("button");
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ helper_en: "After" })]);
    expect(screen.getAllByRole("button", { name: "Saving…" }).every((button) => button.disabled)).toBe(true);
    resolveSave({ questions: [{ key: "taste", label_en: "Taste", helper_en: "After", type: "single_choice", options: [] }] });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit question" })).toBeNull());
  });

  it("keeps the question editor open with a visible error when its canonical save fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Form questions are immutable after responses have been submitted."));
    render(<FormBuilder campaign={{ questions: [{ key: "taste", label_en: "Taste", helper_en: "Existing helper", type: "single_choice", options: [] }] }} editable onSave={onSave} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    expect((await screen.findAllByRole("alert"))[0].textContent).toContain("Form questions are immutable after responses have been submitted.");
    expect(screen.getByRole("heading", { name: "Edit question" })).toBeTruthy();
    expect(screen.getByDisplayValue("Existing helper")).toBeTruthy();
  });

  it("uses returned canonical questions and disables structural saves while a question save is pending", async () => {
    let resolveSave;
    const onSave = vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    render(<FormBuilder campaign={{ questions: [{ key: "taste", label_en: "Taste", helper_en: "Old helper", type: "single_choice", options: [] }] }} editable onSave={onSave} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.change(screen.getByDisplayValue("Old helper"), { target: { value: "Canonical helper" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    expect(screen.getAllByRole("button", { name: "Saving…" }).some((button) => button.disabled)).toBe(true);
    resolveSave({ questions: [{ key: "taste", label_en: "Taste", helper_en: "Canonical helper", type: "single_choice", options: [] }] });
    await waitFor(() => expect(screen.getByText("Question saved.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    expect(screen.getByDisplayValue("Canonical helper")).toBeTruthy();
  });

  it("renders localized helper text with the English fallback and accepts historical questions without it", async () => {
    const question = { key: "taste", label_en: "Taste", label_zh: "口味", helper_en: "Choose what you prefer", type: "single_choice", required: true, options: [{ value: "good", label_en: "Good" }] };
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Tasting", default_language: "en", questions: [question] } });
    render(<FactoryProductFeedbackPublic />);
    expect(await screen.findByText("Choose what you prefer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByText("Choose what you prefer")).toBeTruthy();
    cleanup();
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Tasting", default_language: "en", questions: [{ ...question, helper_en: undefined }] } });
    render(<FactoryProductFeedbackPublic />);
    await screen.findByText("Taste");
    expect(screen.queryByText("Choose what you prefer")).toBeNull();
  });

  it("includes missing helper translations without overwriting an existing language", async () => {
    factoryService.translateProductFeedbackContent.mockResolvedValue([
      { id: "question:helper", language: "zh", text: "中文帮助" },
    ]);
    const onSave = vi.fn().mockResolvedValue({});
    render(<FormBuilder campaign={{ questions: [{ key: "taste", label_en: "Taste", label_zh: "口味", label_ms: "Rasa", helper_en: "Choose carefully", helper_zh: "", helper_ms: "Kekalkan ini", type: "single_choice", options: [] }] }} editable onSave={onSave} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.click(screen.getByRole("button", { name: "AI Translate missing" }));
    await waitFor(() => expect(factoryService.translateProductFeedbackContent).toHaveBeenCalledWith(expect.objectContaining({ units: expect.arrayContaining([expect.objectContaining({ id: "question:helper", source: "Choose carefully", targets: ["zh"] })]) })));
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByDisplayValue("中文帮助")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "BM" }));
    expect(screen.getByDisplayValue("Kekalkan ini")).toBeTruthy();
  });

  it("sends one logical translation request for repeated clicks and keeps missing-only targets", async () => {
    let resolveTranslation;
    factoryService.translateProductFeedbackContent.mockClear();
    factoryService.translateProductFeedbackContent.mockImplementationOnce(() => new Promise((resolve) => { resolveTranslation = resolve; }));
    render(<FormBuilder campaign={{ questions: [{ key: "taste", label_en: "Taste", label_zh: "", label_ms: "Sudah ada", helper_en: "Choose carefully", helper_zh: "", helper_ms: "Kekalkan", type: "single_choice", options: [{ value: "good", label_en: "Good", label_zh: "", label_ms: "Baik" }] }] }} editable onSave={vi.fn()} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const translate = screen.getByRole("button", { name: "AI Translate missing" });
    fireEvent.click(translate);
    fireEvent.click(translate);
    expect(factoryService.translateProductFeedbackContent).toHaveBeenCalledTimes(1);
    expect(factoryService.translateProductFeedbackContent).toHaveBeenCalledWith(expect.objectContaining({ units: expect.arrayContaining([expect.objectContaining({ id: "question:helper", targets: ["zh"] }), expect.objectContaining({ id: "option:0", targets: ["zh"] })]) }));
    resolveTranslation([{ id: "question:helper", language: "zh", text: "请仔细选择" }, { id: "option:0", language: "zh", text: "好" }]);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    await waitFor(() => expect(screen.getByDisplayValue("请仔细选择")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "BM" }));
    expect(screen.getByDisplayValue("Kekalkan")).toBeTruthy();
  });

  it("replaces legacy English Chinese option copies, persists them, and renders them publicly", async () => {
    const question = { key: "spice", label_en: "How spicy is it?", label_zh: "辣度如何？", label_ms: "Tahap kepedasan", helper_en: "Choose one", helper_zh: "请选择一项", helper_ms: "Pilih satu", type: "single_choice", required: true, options: [{ value: "too_mild", label_en: "Too mild", label_zh: "Too mild", label_ms: "Terlalu kurang pedas" }, { value: "just_right", label_en: "Just right", label_zh: "Just right", label_ms: "Sesuai" }] };
    factoryService.translateProductFeedbackContent.mockResolvedValueOnce([{ id: "option:0", language: "zh", text: "太不辣" }, { id: "option:1", language: "zh", text: "刚刚好" }]);
    const onSave = vi.fn().mockResolvedValue({});
    render(<FormBuilder campaign={{ questions: [question] }} editable onSave={onSave} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.click(screen.getByRole("button", { name: "AI Translate missing" }));
    await waitFor(() => expect(factoryService.translateProductFeedbackContent).toHaveBeenCalledWith(expect.objectContaining({ units: expect.arrayContaining([expect.objectContaining({ id: "option:0", targets: ["zh"] }), expect.objectContaining({ id: "option:1", targets: ["zh"] })]) })));
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByDisplayValue("太不辣")).toBeTruthy();
    expect(screen.getByDisplayValue("刚刚好")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ options: [expect.objectContaining({ label_zh: "太不辣", label_ms: "Terlalu kurang pedas" }), expect.objectContaining({ label_zh: "刚刚好", label_ms: "Sesuai" })] })]));
    cleanup();
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Tasting", default_language: "en", questions: [{ ...question, options: [{ ...question.options[0], label_zh: "太不辣" }, { ...question.options[1], label_zh: "刚刚好" }] }] } });
    render(<FactoryProductFeedbackPublic />);
    await screen.findByText("How spicy is it?");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByText("太不辣")).toBeTruthy();
    expect(screen.getByText("刚刚好")).toBeTruthy();
  });

  it("shows a safe retryable translation failure instead of a raw Edge Function error", async () => {
    const onNotify = vi.fn();
    factoryService.translateProductFeedbackContent.mockRejectedValueOnce(Object.assign(new Error("Translation is busy right now. Please retry in a moment."), { code: "provider_rate_limited", retryable: true }));
    render(<FormBuilder campaign={{ questions: [{ key: "taste", label_en: "Taste", helper_en: "Choose carefully", type: "single_choice", options: [] }] }} editable onSave={vi.fn()} onNotify={onNotify} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.click(screen.getByRole("button", { name: "AI Translate missing" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith({ title: "AI translation unavailable", message: "Translation is busy right now. Please retry in a moment.", tone: "error" }));
  });

  it("preserves the existing final submit path when contact collection is disabled", async () => {
    const questions = [{ key: "taste", label_en: "Taste", type: "single_choice", required: true, options: [{ value: "good", label_en: "Good" }] }];
    factoryService.publicProductFeedbackEntry.mockResolvedValue({ available: true, campaign: { name: "Tasting", default_language: "en", questions } });
    render(<FactoryProductFeedbackPublic />);
    fireEvent.click(await screen.findByText("Good"));
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.queryByText("Optional")).toBeNull();
    expect(screen.getByRole("button", { name: "Submit feedback" })).toBeTruthy();
  });
});
