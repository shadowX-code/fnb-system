// @vitest-environment node
import { expect, it } from "vitest";
import { externalAgentEnvironment, gatewayEndpointPath } from "../_shared/externalAgentEnvironment.js";

it("binds each Gateway and Admin probe to its own fixed deployment without issuing authority", () => {
  const production = externalAgentEnvironment("https://oyfobxdoyfuzsodogpgs.supabase.co");
  expect(production.endpoint).toBe("https://oyfobxdoyfuzsodogpgs.supabase.co" + gatewayEndpointPath);
  expect(production.origins).toEqual(["https://os.feedx.my"]);
  const staging = externalAgentEnvironment("https://ujkzdaaadnvcfayuldmh.supabase.co/");
  expect(staging.origins).toEqual(["https://fnb-system-staging.vercel.app", "http://localhost:5173"]);
  expect(staging.endpoint).not.toBe(production.endpoint);
  for (const url of ["", "https://example.com", "http://oyfobxdoyfuzsodogpgs.supabase.co", "https://oyfobxdoyfuzsodogpgs.supabase.co.evil.test"]) expect(externalAgentEnvironment(url)).toBeNull();
});
