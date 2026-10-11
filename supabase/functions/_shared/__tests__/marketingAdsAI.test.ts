import { describe, it, expect, vi } from "vitest";
import {
  estimateAdsAICost,
  adsAIEvidence,
  validateAdsProposal,
  requestAdsAI,
} from "../marketingAdsAI.ts";
const packet = {
  knowledge: { approved_facts: {}, knowledge_revision: 0 },
  report: {
    observed_at: "2026-10-11T00:00:00Z",
    payload: {
      account: { currency: "MYR", timezone: "Asia/Singapore" },
      date_from: "2024-09-01",
      date_to: "2024-09-30",
      configs: { campaigns: [{ id: "1", name: "Confirmed campaign" }] },
      insights: {
        campaign: [
          {
            campaign_id: "1",
            currency: "MYR",
            date_start: "2024-09-01",
            date_stop: "2024-09-30",
            metrics: {
              spend: { value: 0, state: "reported" },
              reach: { value: null, state: "unavailable" },
            },
            actions: [],
          },
          {
            campaign_id: "2",
            currency: "MYR",
            metrics: { spend: { value: 999 } },
          },
        ],
      },
    },
  },
};
const proposal = {
  summary: "Generic performance advice",
  recommendations: [
    {
      category: "strategy",
      metric_reference: "metric:1:spend",
      title: "Review the selected period",
      proposal: "Review campaign goals before changing spend.",
      caution: "Brand context unavailable.",
      reference_keys: ["metric:1:spend"],
    },
  ],
};
describe("Ads advisory grounding", () => {
  it("keeps genuine zero, filters unauthorized campaign evidence and missing metrics", () => {
    const refs = adsAIEvidence(packet);
    expect(Object.keys(refs)).toEqual(["metric:1:spend"]);
    expect(refs["metric:1:spend"].value).toBe(0);
  });
  it("requires a real performance citation and rejects invented references", () => {
    expect(() =>
      validateAdsProposal(
        {
          ...proposal,
          recommendations: [
            {
              ...proposal.recommendations[0],
              reference_keys: ["metric:2:spend"],
            },
          ],
        },
        adsAIEvidence(packet),
      ),
    ).toThrow("ai_evidence_invalid");
  });
  it("annotates validated recommendations advisory-only and attaches server evidence", () => {
    const result = validateAdsProposal(proposal, adsAIEvidence(packet));
    expect(result.external_execution_enabled).toBe(false);
    expect(result.recommendations[0].evidence[0].value).toBe(0);
  });
  it("uses structured Responses without storage or tools and records actual usage", async () => {
    const transport = vi.fn(async (_url, opts) => {
      const req = JSON.parse(opts.body);
      expect(req.store).toBe(false);
      expect(req.tools).toBeUndefined();
      expect(req.text.format.strict).toBe(true);
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          model: "gpt-5-mini",
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: JSON.stringify(proposal) },
              ],
            },
          ],
          usage: { input_tokens: 123, output_tokens: 45 },
        }),
      };
    });
    const r = await requestAdsAI(
      packet,
      "test",
      "gpt-5-mini",
      transport as any,
    );
    expect(r.input).toBe(123);
    expect(r.output).toBe(45);
  });
  it("rejects incomplete provider outcomes rather than inventing a recommendation", async () => {
    await expect(
      requestAdsAI(
        packet,
        "test",
        "gpt-5-mini",
        async () =>
          ({
            ok: true,
            json: async () => ({ status: "incomplete", output: [] }),
          }) as any,
      ),
    ).rejects.toThrow("ai_provider_incomplete");
  });
});

describe("Ads provider cost evidence", () => {
  it("preserves unknown pricing and model mismatch rather than inventing cost", () => {
    expect(
      estimateAdsAICost({ model: "other", input: 100, output: 10, cached: 0 }, [
        ".25",
        ".025",
        "2",
      ]),
    ).toBeNull();
    expect(
      estimateAdsAICost(
        { model: "gpt-5-mini", input: 100, output: 10, cached: 0 },
        ["", ".025", "2"],
      ),
    ).toBeNull();
    expect(
      estimateAdsAICost(
        { model: "gpt-5-mini-2025-08-07", input: 100, output: 10, cached: 20 },
        [".25", ".025", "2"],
      ),
    ).toBeCloseTo(0.0000405);
  });
  it("retains actual usage when completed provider output fails evidence validation", async () => {
    try {
      await requestAdsAI(
        packet,
        "test",
        "gpt-5-mini",
        async () =>
          ({
            ok: true,
            json: async () => ({
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "{}" }],
                },
              ],
              usage: { input_tokens: 100, output_tokens: 10 },
            }),
          }) as any,
      );
      throw new Error("Expected rejection");
    } catch (error: any) {
      expect(error.message).toBe("ai_shape_invalid");
      expect(error.usage.input).toBe(100);
    }
  });
});
