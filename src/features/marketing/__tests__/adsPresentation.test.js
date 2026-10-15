import { describe, it, expect } from "vitest";
import {
  adsMetric,
  metricComparison,
  precedingPeriod,
  adsManagerUrl,
} from "../adsPresentation.js";
describe("advertising presentation", () => {
  it("keeps unavailable distinct from zero and currencies explicit", () => {
    expect(adsMetric(null, "spend", "MYR")).toBe("—");
    expect(adsMetric({ value: 0 }, "spend", "MYR")).toBe("MYR 0");
    expect(adsMetric({ value: 1.2 }, "ctr")).toBe("1.2%");
  });
  it("compares equivalent inclusive periods without division by zero", () => {
    expect(precedingPeriod("2026-10-01", "2026-10-11")).toEqual({
      from: "2026-09-20",
      to: "2026-09-30",
    });
    expect(metricComparison({ value: 1 }, { value: 0 })).toBe(
      "No comparable baseline",
    );
    expect(metricComparison({ value: 0 }, { value: 0 })).toBe("No change");
    expect(metricComparison({ value: 2 }, null)).toBeNull();
  });
  it("links only numeric authorized account identities to official Ads Manager", () => {
    expect(adsManagerUrl("111", "222", "adset")).toContain(
      "selected_adset_ids=222",
    );
    expect(adsManagerUrl("https://elsewhere")).toBeNull();
  });
});

it("exposes attribution spend only in organization scope", async () => {
  const { attributionSpend } = await import("../adsPresentation.js");
  expect(
    attributionSpend({
      scope: "attributed_campaigns",
      insights: { attribution_spend: [{ reported_spend: 123 }] },
    }),
  ).toEqual([]);
  expect(
    attributionSpend({
      scope: "organization",
      insights: {
        attribution_spend: [{ brand_id: null, reported_spend: null }],
      },
    })[0].reported_spend,
  ).toBeNull();
});

it('uses exact objective/action definitions and matching costs, preserving zero and missing', async()=>{
  const {campaignResult}=await import('../adsPresentation.js');
  const row={actions:[{type:'link_click',value:0},{type:'post_engagement',value:100},{type:'onsite_conversion.messaging_conversation_started_7d',value:3}],cost_per_action_type:[{type:'post_engagement',value:1},{type:'onsite_conversion.messaging_conversation_started_7d',value:10}]};
  expect(campaignResult(row,{objective:'OUTCOME_TRAFFIC'})).toMatchObject({type:'link_click',value:0,cost:null});
  expect(campaignResult(row,{objective:'OUTCOME_ENGAGEMENT'})).toMatchObject({type:'onsite_conversion.messaging_conversation_started_7d',value:3,cost:10});
  expect(campaignResult(row,{objective:'OUTCOME_SALES'})).toBeNull();
  expect(campaignResult(row,{},'purchase')).toMatchObject({type:'purchase',value:null,cost:null});
});
it('keeps missing provider-local daily observations as gaps and explicit zero as zero',async()=>{
  const {adsDailySpend}=await import('../adsPresentation.js');
  expect(adsDailySpend({date_from:'2026-10-07',date_to:'2026-10-09',insights:{daily:[{date_start:'2026-10-07',metrics:{spend:{value:0}}},{date_start:'2026-10-09',metrics:{spend:{value:10}}}]}})).toEqual([{date:'2026-10-07',spend:0},{date:'2026-10-08',spend:null},{date:'2026-10-09',spend:10}]);
});
