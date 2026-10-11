import { describe, it, expect } from "vitest";
import { campaignEvidence, attributionGroups } from "../adsAttribution.js";
const report = {
  configs: {
    campaigns: [
      { id: "1", name: "Hola launch" },
      { id: "2", name: "VFORCE" },
      { id: "3", name: "Idamans Food Industry promo" },
      { id: "4", name: "Unknown" },
    ],
    ads: [
      {
        campaign_id: "1",
        creative: { object_story_spec: { page_id: "113234221623434" } },
      },
      {
        campaign_id: "2",
        creative: { object_story_spec: { page_id: "113234221623434" } },
      },
    ],
  },
};
describe("campaign evidence review", () => {
  it("groups by returned identities without attributing from names", () => {
    const rows = campaignEvidence(report, [
      { id: "i", name: "Idamans Food Industry" },
    ]);
    expect(rows[2].evidence.hints).toEqual(["i"]);
    expect(rows.every((r) => r.feedx_brand_id === undefined)).toBe(true);
    const groups = attributionGroups(rows);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(groups[0].batchable).toBe(true);
    expect(groups[1].batchable).toBe(false);
  });
  it("uses exact canonical connected identities for suggested matches", () => {
    const rows = campaignEvidence(
      report,
      [],
      [
        {
          brand_id: "hola",
          channel: "facebook",
          account_id: "113234221623434",
        },
        {
          brand_id: "idamans",
          channel: "instagram",
          account_id: "113234221623434",
        },
      ],
    );
    expect(rows[0].evidence.matches).toEqual(["hola"]);
    expect(rows[0].feedx_brand_id).toBeUndefined();
  });
  it("mixed identities or competing brand matches require individual review", () => {
    const mixed = structuredClone(report);
    mixed.configs.ads.push({
      campaign_id: "1",
      creative: { object_story_spec: { page_id: "106367211603584" } },
    });
    expect(attributionGroups(campaignEvidence(mixed))[0].batchable).toBe(false);
    const rows = campaignEvidence(
      report,
      [],
      [
        { brand_id: "a", channel: "facebook", account_id: "113234221623434" },
        { brand_id: "b", channel: "facebook", account_id: "113234221623434" },
      ],
    );
    expect(rows[0].evidence.conflict).toBe(true);
  });
  it("never substitutes malformed identity values or partial brand names", () => {
    const bad = {
      configs: {
        campaigns: [{ id: "1", name: "NotIdamans Food Industry" }],
        ads: [
          {
            campaign_id: "1",
            creative: { object_story_spec: { page_id: "bad" } },
          },
        ],
      },
    };
    expect(
      campaignEvidence(bad, [{ id: "i", name: "Idamans Food Industry" }])[0]
        .evidence,
    ).toMatchObject({ key: "unresolved", pages: [], hints: [] });
  });
});
