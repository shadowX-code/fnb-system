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
    expect(groups[0].batchable).toBe(false);
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

it('separates complete and partial identity groups and blocks unmatched secondary assets',()=>{
 const partial=structuredClone(report);partial.configs.ads.push({campaign_id:'2',creative:{id:'hidden'}});
 const ids=[{brand_id:'hola',channel:'facebook',account_id:'113234221623434'}];
 const rows=campaignEvidence(partial,[],ids);
 expect(rows[0].evidence).toMatchObject({ready:true,status:'verified',known:1,total:1});
 expect(rows[1].evidence).toMatchObject({ready:false,status:'partial',known:1,total:2});
 expect(rows[0].evidence.key).not.toBe(rows[1].evidence.key);
 expect(attributionGroups(rows).filter(g=>g.batchable).flatMap(g=>g.rows.map(c=>c.id))).toEqual(['1']);
 partial.configs.ads[0].creative.object_story_spec.instagram_user_id='123';
 expect(campaignEvidence(partial,[],ids)[0].evidence).toMatchObject({ready:false,status:'unmatched'});
});
it('preserves exactly the five fully evidenced Hola proposals and excludes 47 other campaigns',()=>{
 const five=['120211987048750774','120211923697060774','120211843422720774','120211300921170774','120211163810570774'];
 const ids=[{brand_id:'965ed560-5427-4e3c-ab06-e75bcc228804',channel:'facebook',account_id:'113234221623434'},{brand_id:'965ed560-5427-4e3c-ab06-e75bcc228804',channel:'instagram',account_id:'17841457435511713'}];
 const campaigns=[...five,...Array.from({length:47},(_,i)=>String(i+1))].map(id=>({id,name:'Campaign '+id}));
 const ads=five.map(campaign_id=>({campaign_id,creative:{object_story_spec:{page_id:'113234221623434',instagram_user_id:'17841457435511713'}}}));
 ads.push({campaign_id:'1',creative:{object_story_spec:{page_id:'113234221623434'}}},{campaign_id:'1',creative:{id:'unavailable'}});
 const result=campaignEvidence({configs:{campaigns,ads}},[],ids);
 expect(result.filter(c=>c.evidence.ready).map(c=>c.id)).toEqual(five);
 expect(result.filter(c=>!c.evidence.ready)).toHaveLength(47);
 expect(result.every(c=>c.feedx_brand_id===undefined)).toBe(true);
});
