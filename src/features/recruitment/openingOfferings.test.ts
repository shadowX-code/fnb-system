import { expect, it } from "vitest";
import {
  hourlyExplanation,
  offeringContext,
} from "../../../supabase/functions/recruitment-realtime/offerings.ts";
import {
  cachedSample,
  sampleKey,
} from "../../../supabase/functions/recruitment-voice-lab/cache.ts";
const part = {
  id: "part",
  employment_type: "part_time",
  compensation_type: "hourly",
  currency: "MYR",
  amount_min: 8,
  break_threshold_hours: 8,
  break_minutes: 60,
  break_paid: false,
};
it("calculates ordinary hourly explanations at the configured threshold, without Payroll/OT or model arithmetic", () => {
  expect(hourlyExplanation(part, 6)).toMatchObject({
    paid_hours: 6,
    amount: 48,
    break_minutes: 0,
  });
  expect(hourlyExplanation(part, 10)).toMatchObject({
    paid_hours: 9,
    amount: 72,
    break_minutes: 60,
  });
  expect(hourlyExplanation(part, 8)).toMatchObject({
    paid_hours: 7,
    amount: 56,
  });
  expect(hourlyExplanation(part, 7.5)).toMatchObject({
    paid_hours: 7.5,
    amount: 60,
  });
  expect(hourlyExplanation(part, 6.1)).toBeNull();
  expect(hourlyExplanation({ ...part, break_paid: undefined }, 6)).toBeNull();
  expect(hourlyExplanation({ ...part, amount_max: 10 }, 6)).toBeNull();
});
it("presents offering-specific confirmed context without altering evidence/performance or final salary authority", () => {
  const result = offeringContext(
    [
      part,
      {
        id: "full",
        employment_type: "full_time",
        compensation_type: "monthly",
        amount_min: 1800,
        amount_max: 2200,
        currency: "MYR",
      },
    ],
    { location: "Pengkalan / Pasir Puteh" },
  );
  expect(result).toContain('"amount":48');
  expect(result).toContain('"amount":72');
  expect(result).toContain("never assign, negotiate or promise a final salary");
  expect(result).toContain("OT policy/calculation");
  expect(result).toContain("Employment preference is not performance");
  expect(result).toContain("Never combine terms");
  expect(offeringContext([], {})).toBe("");
});
it("persists audio once and reuses it across requests; version, language and voice identify samples", async () => {
  let stored = null,
    generations = 0,
    claimed = false;
  const ops = {
    key: "a",
    read: async () => stored,
    claim: async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    write: async (audio) => {
      stored = audio;
    },
    release: async () => {
      claimed = false;
    },
    generate: async () => {
      generations++;
      return new Uint8Array(48);
    },
  };
  await cachedSample(ops);
  await cachedSample(ops);
  expect(generations).toBe(1);
  expect(await sampleKey("marin", "en")).not.toBe(
    await sampleKey("marin", "ms"),
  );
  expect(await sampleKey("marin", "en")).not.toBe(
    await sampleKey("cedar", "en"),
  );
});
it("cache faults and concurrent preparation do not spend again", async () => {
  let generations = 0;
  const ops = {
    key: "a",
    read: async () => null,
    claim: async () => false,
    write: async () => {},
    release: async () => {},
    generate: async () => {
      generations++;
      return new Uint8Array(48);
    },
  };
  await expect(cachedSample(ops)).rejects.toThrow("being prepared");
  await expect(
    cachedSample({
      ...ops,
      read: async () => {
        throw Error("storage offline");
      },
    }),
  ).rejects.toThrow("storage offline");
  expect(generations).toBe(0);
});
