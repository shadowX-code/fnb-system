import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  advanceAdsChange,
  bytesHash,
  createPayloads,
} from "../../../../supabase/functions/_shared/metaAdsManagement.ts";
import { MetaError } from "../../../../supabase/functions/_shared/metaGraph.ts";
const base = {
  id: "req",
  account_id: "111",
  fingerprint: "pin",
  maximum_budget: 50000,
  operation: "create",
  configuration: {
    name: "Reviewed",
    objective: "OUTCOME_TRAFFIC",
    start_time: "2099-01-01T00:00:00+08:00",
    end_time: "2099-01-02T00:00:00+08:00",
    page_id: "222",
    instagram_id: "333",
    placements: "both_feeds",
    age_min: 18,
    age_max: 65,
    url: "https://example.invalid",
    caption: "Approved",
    headline: "Reviewed",
    media: { sha256: "" },
  },
};
function harness(change: any = base) {
  let state: any = {};
  const writes: any[] = [],
    guard = vi.fn().mockResolvedValue(undefined),
    checkpoint = async (s: any) => {
      state = structuredClone(s);
      writes.push(state);
    };
  const request = vi.fn();
  return {
    request,
    guard,
    writes,
    state: () => state,
    run: (extra: any = {}) =>
      advanceAdsChange({
        graph: { request },
        token: "unit-token",
        change,
        state,
        guard,
        checkpoint,
        ...extra,
      }),
  };
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
describe("controlled Meta mutation contract", () => {
  it("uses bounded campaign-level lifetime budget and PAUSED hierarchy, with exact creative and placements", () => {
    const p = createPayloads(base, {
      campaign_id: "1",
      adset_id: "2",
      image_hash: "hash",
      creative_id: "3",
    });
    expect(p.campaign).toMatchObject({
      lifetime_budget: "50000",
      status: "PAUSED",
      objective: "OUTCOME_TRAFFIC",
    });
    expect(p.adset).not.toHaveProperty("daily_budget");
    expect(p.adset.targeting).toMatchObject({
      geo_locations: { countries: ["MY"] },
      facebook_positions: ["feed"],
      instagram_positions: ["stream"],
    });
    expect(p.creative.object_story_spec).toMatchObject({
      page_id: "222",
      instagram_user_id: "333",
      link_data: { image_hash: "hash", message: "Approved" },
    });
    expect(p.ad.status).toBe("PAUSED");
  });
  it("rejects creative changes and exact-authorizer Page access failures before any write", async () => {
    const h = harness();
    h.request.mockResolvedValue({ data: [{ id: "222", tasks: ["ANALYZE"] }] });
    await expect(h.run({ bytes: new Uint8Array([1]) })).rejects.toThrow(
      "ad_page_authorization_unverified",
    );
    expect(h.request.mock.calls.every((c) => c[3] !== "POST")).toBe(true);
    h.request.mockResolvedValue({
      data: [
        {
          id: "222",
          tasks: ["ADVERTISE"],
          instagram_business_account: { id: "333" },
        },
      ],
    });
    await expect(h.run({ bytes: new Uint8Array([1]) })).rejects.toThrow(
      "ad_creative_changed",
    );
    expect(h.writes).toHaveLength(0);
  });
  it("checkpoints exact accepted ids and reconciles paused nodes, without repeating known writes", async () => {
    const bytes = new Uint8Array([1]);
    const c = structuredClone(base);
    c.configuration.media.sha256 = await bytesHash(bytes);
    const h = harness(c);
    const campaign = {
        id: "901",
        status: "PAUSED",
        objective: "OUTCOME_TRAFFIC",
        lifetime_budget: "50000",
      },
      adset = { id: "902", campaign_id: "901", status: "PAUSED" },
      ad = {
        id: "904",
        campaign_id: "901",
        adset_id: "902",
        status: "PAUSED",
        creative: { id: "903" },
      };
    Object.assign(adset, {
      targeting: createPayloads(c, {}).adset.targeting,
      start_time: c.configuration.start_time,
      end_time: c.configuration.end_time,
      optimization_goal: "LINK_CLICKS",
      billing_event: "IMPRESSIONS",
    });
    Object.assign(ad.creative, {
      object_story_spec: createPayloads(c, { image_hash: "hash" }).creative
        .object_story_spec,
    });
    h.request.mockImplementation(
      async (path: string, _token: string, _p: any, method: string) =>
        method === "POST"
          ? path.endsWith("adimages")
            ? { images: { image: { hash: "hash" } } }
            : {
                id: path.endsWith("campaigns")
                  ? "901"
                  : path.endsWith("adsets")
                    ? "902"
                    : path.endsWith("adcreatives")
                      ? "903"
                      : "904",
              }
          : path === "me/accounts"
            ? {
                data: [
                  {
                    id: "222",
                    tasks: ["ADVERTISE"],
                    instagram_business_account: { id: "333" },
                  },
                ],
              }
            : {
                data: path.endsWith("campaigns")
                  ? [campaign]
                  : path.endsWith("adsets")
                    ? [adset]
                    : [ad],
              },
    );
    expect(await h.run({ bytes })).toMatchObject({
      outcome: "succeeded",
      receipt: {
        campaign_id: "901",
        adset_id: "902",
        ad_id: "904",
        reconciled: true,
      },
    });
    expect(h.request.mock.calls.filter((c) => c[3] === "POST")).toHaveLength(5);
    expect(await h.run({ reconcileOnly: true })).toMatchObject({
      outcome: "succeeded",
    });
    expect(h.request.mock.calls.filter((c) => c[3] === "POST")).toHaveLength(5);
    expect(h.writes[0]).toEqual({ pending: "image" });
    expect(JSON.stringify(h.state())).not.toContain("unit-token");
  });
  it("never repeats a pending creation after network ambiguity", async () => {
    const bytes = new Uint8Array([2]);
    const c = structuredClone(base);
    c.configuration.media.sha256 = await bytesHash(bytes);
    const h = harness(c);
    h.request.mockImplementation(async (path, _t, _p, method) => {
      if (method === "POST")
        throw new MetaError("meta_response_uncertain", true);
      return {
        data: [
          {
            id: "222",
            tasks: ["MANAGE"],
            instagram_business_account: { id: "333" },
          },
        ],
      };
    });
    await expect(h.run({ bytes })).rejects.toThrow("meta_response_uncertain");
    expect(h.state()).toMatchObject({ pending: "image" });
    expect(await h.run({ reconcileOnly: true })).toMatchObject({
      outcome: "reconciling",
    });
    expect(h.request.mock.calls.filter((c) => c[3] === "POST")).toHaveLength(1);
  });
  it("rejects changed external state and never patches unrelated Meta settings", async () => {
    const c = {
      ...base,
      operation: "budget",
      configuration: { campaign_id: "901" },
      baseline: {
        campaign: { id: "901", status: "PAUSED", lifetime_budget: "10000" },
        adsets: [],
        ads: [],
      },
    };
    const h = harness(c);
    h.request.mockImplementation(async (path) => ({
      data: path.endsWith("campaigns")
        ? [{ ...c.baseline.campaign, lifetime_budget: "12000" }]
        : [],
    }));
    await expect(h.run()).rejects.toThrow("meta_configuration_changed");
    expect(h.request.mock.calls.filter((c) => c[3] === "POST")).toHaveLength(0);
  });
  it("requires an accepted update receipt before read-only status reconciliation", async () => {
    const c = {
      ...base,
      operation: "pause",
      configuration: { campaign_id: "901" },
      baseline: {
        campaign: { id: "901", status: "ACTIVE" },
        adsets: [],
        ads: [],
      },
    };
    const h = harness(c);
    h.request.mockImplementation(async (path, _t, p, method) =>
      method === "POST"
        ? { success: true }
        : {
            data: path.endsWith("campaigns")
              ? [
                  {
                    id: "901",
                    status: h.state().update_accepted ? "PAUSED" : "ACTIVE",
                  },
                ]
              : [],
          },
    );
    expect(await h.run()).toMatchObject({ outcome: "succeeded" });
    expect(h.request.mock.calls.filter((c) => c[3] === "POST")[0][2]).toEqual({
      status: "PAUSED",
    });
    const untouched = harness(c);
    untouched.request.mockResolvedValue({ data: [] });
    expect(await untouched.run({ reconcileOnly: true })).toMatchObject({
      outcome: "reconciling",
    });
  });
});
describe("explicit hierarchy activation scope", () => {
  it("activates verified children before the paused parent, using only status patches", async () => {
    const tree = {
      campaign: { id: "901", status: "PAUSED", lifetime_budget: "50000" },
      adsets: [{ id: "902", campaign_id: "901", status: "PAUSED" }],
      ads: [
        { id: "904", adset_id: "902", campaign_id: "901", status: "PAUSED" },
      ],
    };
    const c = {
      ...base,
      operation: "resume",
      configuration: { campaign_id: "901", resume_scope: "feedx_hierarchy" },
      baseline: structuredClone(tree),
    };
    const h = harness(c);
    h.request.mockImplementation(async (path, _token, p, method) => {
      if (method === "POST") {
        const row = [tree.campaign, ...tree.adsets, ...tree.ads].find(
          (r) => r.id === path,
        )!;
        row.status = p.status;
        return { success: true };
      }
      return {
        data: path.endsWith("campaigns")
          ? [tree.campaign]
          : path.endsWith("adsets")
            ? tree.adsets
            : tree.ads,
      };
    });
    expect(await h.run()).toMatchObject({ outcome: "succeeded" });
    expect(
      h.request.mock.calls
        .filter((c) => c[3] === "POST")
        .map((c) => [c[0], c[2]]),
    ).toEqual([
      ["902", { status: "ACTIVE" }],
      ["904", { status: "ACTIVE" }],
      ["901", { status: "ACTIVE" }],
    ]);
  });
});
it("does not repeat an ambiguous existing-campaign mutation after restart", async () => {
  const h = harness({
    ...base,
    operation: "budget",
    configuration: { campaign_id: "901" },
    baseline: {
      campaign: { id: "901", lifetime_budget: "40000" },
      adsets: [],
      ads: [],
    },
  });
  expect(await h.run({ state: { pending: "update" } })).toMatchObject({
    outcome: "reconciling",
  });
  expect(h.request).not.toHaveBeenCalled();
});
