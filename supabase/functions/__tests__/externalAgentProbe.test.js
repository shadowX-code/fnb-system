import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { signProbe, isAdminProbe, tokenHash } from "../_shared/externalAgentProbe.js";
afterEach(() => vi.unstubAllGlobals());
it("separates trusted Admin probes from external clients without transmitting a server credential", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const credential = `fxm_${"a".repeat(43)}`, secret = "synthetic-server-key";
  const proof = await signProbe(secret, credential);
  expect(await isAdminProbe(secret, credential, proof)).toBe(true);
  expect(await isAdminProbe("other-key", credential, proof)).toBe(false);
  expect(await isAdminProbe(secret, `fxm_${"b".repeat(43)}`, proof)).toBe(false);
  expect(await isAdminProbe(secret, credential, "admin_probe")).toBe(false);
  expect(proof).not.toContain(secret);
  expect(proof).not.toContain(credential);
  expect(await tokenHash(credential)).toMatch(/^[a-f0-9]{64}$/);
});
