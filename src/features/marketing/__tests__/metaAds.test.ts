import { webcrypto } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaGraph } from "../../../../supabase/functions/_shared/metaGraph.ts";
import {
  adsAccount,
  adsInsight,
  adsPages,
  discoverAds,
  verifyAdsAccount,
  readAdsReport,
} from "../../../../supabase/functions/_shared/metaAds.ts";
const config = {
  appId: "123",
  appSecret: "unit-secret",
  configId: "456",
  version: "v26.0",
};
const row = {
  id: "act_111",
  account_id: "111",
  name: "Unit Ad Account",
  currency: "MYR",
  timezone_name: "Asia/Kuala_Lumpur",
  account_status: 1,
  user_tasks: ["ANALYZE", "ADVERTISE"],
};
const reply = (value: any) => new Response(JSON.stringify(value));
describe("Meta Ads independent authorization and evidence", () => {
  beforeEach(() => vi.stubGlobal("crypto", webcrypto));
  afterEach(() => vi.unstubAllGlobals());
  it("requires account identity and grants, never Page tasks or synchronization alone", () => {
    expect(adsAccount(row, ["ads_read"])).toMatchObject({
      read_verified: true,
      manage_verified: false,
      execution_enabled: false,
    });
    expect(adsAccount(row, ["ads_management"])).toMatchObject({
      manage_verified: true,
      execution_enabled: false,
    });
    expect(
      adsAccount({ ...row, user_tasks: ["CREATE_CONTENT"] }, ["ads_management"])
        .manage_verified,
    ).toBe(false);
    expect(
      adsAccount({ ...row, account_status: 2 }, ["ads_management"])
        .manage_verified,
    ).toBe(false);
    expect(() => adsAccount({ ...row, id: "act_999" }, ["ads_read"])).toThrow(
      "ad_account_identity_mismatch",
    );
  });
  it("discovers using a user token without returning credentials in candidate metadata", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(reply({ access_token: "short" }))
      .mockResolvedValueOnce(
        reply({ access_token: "user-secret", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        reply({
          data: {
            is_valid: true,
            type: "USER",
            app_id: "123",
            user_id: "789",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            scopes: ["ads_read"],
          },
        }),
      )
      .mockResolvedValueOnce(reply({ data: [row] }));
    const result = await discoverAds(
      new MetaGraph(config, transport),
      "test-code",
    );
    expect(result.accounts[0].id).toBe("111");
    expect(JSON.stringify(result.accounts)).not.toContain("user-secret");
    expect(new URL(transport.mock.calls[3][0]).pathname).toBe(
      "/v26.0/me/adaccounts",
    );
    expect(transport.mock.calls.every((c) => c[1].method === "GET")).toBe(true);
  });
  it("rejects invalid authorizers and accounts omitted from me/adaccounts", async () => {
    for (const [debug, accounts, reason] of [
      [
        {
          is_valid: true,
          type: "PAGE",
          app_id: "123",
          user_id: "789",
          scopes: ["ads_read"],
        },
        [],
        "meta_permission_or_token_invalid",
      ],
      [
        {
          is_valid: true,
          type: "USER",
          app_id: "123",
          user_id: "other",
          scopes: ["ads_read"],
        },
        [],
        "meta_permission_or_token_invalid",
      ],
      [
        {
          is_valid: true,
          type: "USER",
          app_id: "123",
          user_id: "789",
          scopes: ["ads_read"],
        },
        [],
        "ad_account_access_unverified",
      ],
    ]) {
      const transport = vi
        .fn()
        .mockResolvedValueOnce(reply({ data: debug }))
        .mockResolvedValueOnce(reply({ data: accounts }));
      await expect(
        verifyAdsAccount(
          new MetaGraph(config, transport),
          "123",
          "unit-secret",
          "token",
          "111",
          "789",
        ),
      ).rejects.toThrow(reason);
    }
  });
  it("preserves zero, missing data and non-additive estimated reach", () => {
    const result = adsInsight({
      spend: "0",
      impressions: "0",
      reach: "0",
      ctr: "",
      actions: [{ action_type: "link_click", value: "0" }],
    });
    expect(result.metrics.spend).toEqual({ value: 0, state: "reported" });
    expect(result.metrics.reach).toEqual({ value: 0, state: "estimated" });
    expect(result.metrics.ctr).toEqual({ value: null, state: "unavailable" });
    expect(result.actions).toEqual([{ type: "link_click", value: 0 }]);
    expect(result.cost_per_action_type).toBeNull();
    expect(result.attribution).toContain("not verified FeedX sales");
  });
  it("does not follow provider next URLs, and refuses incomplete pagination", async () => {
    const graph = {
      request: vi
        .fn()
        .mockResolvedValue({
          data: [row],
          paging: { next: "https://attacker.example/token" },
        }),
    } as unknown as MetaGraph;
    await expect(
      adsPages(graph, "me/adaccounts", "secret", {}),
    ).rejects.toThrow("ads_pagination_unavailable");
    expect(graph.request).toHaveBeenCalledTimes(1);
  });
  it("keeps core campaign configuration when optional insights are denied", async () => {
    const graph = {
      request: vi.fn(async (path: string) => {
        if (path.endsWith("/insights")) throw new Error("private-error");
        return { data: [{ id: "222", name: "Existing campaign" }] };
      }),
    } as unknown as MetaGraph;
    const report = await readAdsReport(
      graph,
      adsAccount(row, ["ads_read"]),
      "token",
      "2026-10-01",
      "2026-10-11",
      async () => {},
    );
    expect(report.configs.campaigns).toHaveLength(1);
    expect(report.insights.account).toEqual([]);
    expect(Object.keys(report.warnings)).toHaveLength(5);
    expect(JSON.stringify(report)).not.toContain("private-error");
    expect(graph.request).toHaveBeenCalledTimes(8);
  });
  it("accepts only fixed Graph hosts and numeric ad account paths", async () => {
    const graph = new MetaGraph(
      config,
      vi.fn().mockResolvedValue(reply({ data: [] })),
    );
    await expect(graph.request("act_111/insights", "token")).resolves.toEqual({
      data: [],
    });
    await expect(
      graph.request("https://attacker.example/act_111", "token"),
    ).rejects.toThrow("invalid_meta_endpoint");
  });
});
