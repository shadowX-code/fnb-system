import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { MetaGraph } from "../../../../supabase/functions/_shared/metaGraph.ts";
import { validatePausedAdSet } from "../../../../supabase/functions/_shared/metaAdsValidation.ts";
const change = {
  state: "reconciling",
  operation: "create",
  account_id: "111",
  maximum_budget: 1000,
  provider_state: { pending: "adset", campaign_id: "222" },
  configuration: {
    name: "Private campaign",
    objective: "OUTCOME_AWARENESS",
    age_min: 18,
    age_max: 65,
    placements: "both_feeds",
    start_time: "2099-01-01T09:00:00+08:00",
    end_time: "2099-01-02T18:00:00+08:00",
  },
};
const campaign = {
  id: "222",
  account_id: "111",
  name: "Private campaign",
  status: "PAUSED",
  effective_status: "PAUSED",
  objective: "OUTCOME_AWARENESS",
  lifetime_budget: "1000",
  buying_type: "AUCTION",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  special_ad_categories: [],
};
const response = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
describe("non-mutating Ad Set validation", () => {
  it("validates a pinned declaration-only draft against the accepted parent without creation", async () => {
    const draft: any = structuredClone(change);
    draft.state = "draft";
    Object.assign(draft.configuration, {
      recovery_source: "source",
      adset_contract_version: 2,
      regional_regulated_categories: ["MALAYSIA_UNIVERSAL"],
      regional_regulation_identities: {
        universal_beneficiary: "444",
        universal_payer: "555",
      },
      promoted_object: { page_id: "333" },
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce({ success: true });
    expect(
      await validatePausedAdSet(
        { request } as any,
        "unit-token",
        draft,
        vi.fn(),
      ),
    ).toMatchObject({ valid: true, mode: "validate_only" });
    expect(request.mock.calls[1]).toEqual([
      "act_111/adsets",
      "unit-token",
      expect.objectContaining({
        campaign_id: "222",
        promoted_object: { page_id: "333" },
        execution_options: ["validate_only"],
        regional_regulated_categories: ["MALAYSIA_UNIVERSAL"],
        regional_regulation_identities: {
          universal_beneficiary: "444",
          universal_payer: "555",
        },
      }),
      "POST",
    ]);
    expect(draft.state).toBe("draft");
    expect(draft.provider_state).toEqual(change.provider_state);
  });
  it("forces validate_only on the exact accepted campaign and preserves the original intent", async () => {
    const before = structuredClone(change),
      guard = vi.fn().mockResolvedValue(undefined);
    const transport = vi
      .fn()
      .mockResolvedValueOnce(response(campaign))
      .mockResolvedValueOnce(response({ success: true }));
    const graph = new MetaGraph(
      {
        appId: "123",
        appSecret: "private-secret",
        configId: "456",
        version: "v26.0",
      },
      transport,
    );
    expect(
      await validatePausedAdSet(graph, "private-token", change, guard),
    ).toMatchObject({
      mode: "validate_only",
      valid: true,
      campaign_matches: true,
    });
    const post = transport.mock.calls[1];
    expect(new URL(post[0]).pathname).toBe("/v26.0/act_111/adsets");
    expect(post[1].method).toBe("POST");
    const form = new URLSearchParams(post[1].body);
    expect(form.get("execution_options")).toBe('["validate_only"]');
    expect(form.get("campaign_id")).toBe("222");
    expect(form.get("status")).toBe("PAUSED");
    expect(form.get("optimization_goal")).toBe("IMPRESSIONS");
    expect(form.has("lifetime_budget")).toBe(false);
    expect(change).toEqual(before);
    expect(guard).toHaveBeenCalledTimes(2);
  });
  it("retains bounded actionable diagnostics, stripping credentials, request values and arbitrary error_data", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(response(campaign))
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: 100,
              error_subcode: 18157520,
              error_user_title: "Targeting setting required",
              fbtrace_id: "Safe_Trace-123",
              is_transient: false,
              error_user_msg:
                "Set targeting_automation. private-token private-secret Private campaign https://private.test?token=x alice@example.test +60123456789",
              message: "Invalid parameter",
              error_data: {
                blame_field_specs: [
                  ["targeting", "targeting_automation"],
                  ["private-token"],
                ],
                access_token: "private-token",
                extra: "private-profile",
              },
            },
          },
          400,
        ),
      );
    const graph = new MetaGraph(
      {
        appId: "123",
        appSecret: "private-secret",
        configId: "456",
        version: "v26.0",
      },
      transport,
    );
    const result = await validatePausedAdSet(
      graph,
      "private-token",
      change,
      vi.fn(),
    );
    expect(result).toMatchObject({
      valid: false,
      error: {
        http_status: 400,
        code: 100,
        error_subcode: 18157520,
        fbtrace_id: "Safe_Trace-123",
        blame_field_specs: [["targeting", "targeting_automation"]],
        error_user_title: "Targeting setting required",
      },
    });
    const evidence = JSON.stringify(result.error);
    for (const secret of [
      "private-token",
      "private-secret",
      "Private campaign",
      "https://private",
      "alice@",
      "60123456789",
      "private-profile",
    ])
      expect(evidence).not.toContain(secret);
    expect(result.error?.error_user_msg).toContain("targeting_automation");
  });
  it("does not broaden OAuth or other endpoint error disclosure", async () => {
    const transport = vi.fn().mockResolvedValue(
      response(
        {
          error: {
            code: 190,
            error_user_msg: "private-token",
            fbtrace_id: "trace",
          },
        },
        400,
      ),
    );
    const graph = new MetaGraph(
      {
        appId: "123",
        appSecret: "private-secret",
        configId: "456",
        version: "v26.0",
      },
      transport,
    );
    await expect(
      graph.request("oauth/access_token", "", { code: "private-code" }),
    ).rejects.toMatchObject({
      adsEvidence: undefined,
      message: "meta_permission_or_token_invalid",
    });
  });
  it("rejects changed or foreign campaign configuration before POST", async () => {
    for (const patch of [
      { account_id: "999" },
      { status: "ACTIVE" },
      { effective_status: "ACTIVE" },
      { lifetime_budget: "2000" },
      { objective: "OUTCOME_SALES" },
      { name: "Other campaign" },
      { buying_type: "RESERVED" },
      { bid_strategy: "COST_CAP" },
      { special_ad_categories: ["EMPLOYMENT"] },
    ]) {
      const request = vi.fn().mockResolvedValue({ ...campaign, ...patch });
      await expect(
        validatePausedAdSet({ request } as any, "unit-token", change, vi.fn()),
      ).rejects.toThrow("meta_configuration_changed");
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses pending receipts for other steps or accepted Ad Sets without any request", async () => {
    for (const patch of [
      { state: "approved" },
      { operation: "resume" },
      { provider_state: { pending: "campaign", campaign_id: "222" } },
      {
        provider_state: {
          pending: "adset",
          campaign_id: "222",
          adset_id: "333",
        },
      },
    ]) {
      const request = vi.fn();
      await expect(
        validatePausedAdSet(
          { request } as any,
          "unit-token",
          { ...change, ...patch },
          vi.fn(),
        ),
      ).rejects.toThrow("adset_validation_not_available");
      expect(request).not.toHaveBeenCalled();
    }
  });
  it("cannot validate after authority changes and never retries a provider ambiguity", async () => {
    const guard = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("scope revoked"));
    const request = vi.fn().mockResolvedValue(campaign);
    await expect(
      validatePausedAdSet({ request } as any, "unit-token", change, guard),
    ).rejects.toThrow("scope revoked");
    expect(request).toHaveBeenCalledTimes(1);
    const transport = vi
      .fn()
      .mockResolvedValueOnce(response(campaign))
      .mockRejectedValueOnce(new Error("private network error"));
    const graph = new MetaGraph(
      {
        appId: "123",
        appSecret: "private-secret",
        configId: "456",
        version: "v26.0",
      },
      transport,
    );
    await expect(
      validatePausedAdSet(graph, "private-token", change, vi.fn()),
    ).rejects.toMatchObject({ code: "meta_response_uncertain" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
