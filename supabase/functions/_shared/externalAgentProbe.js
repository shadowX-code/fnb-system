const bytes = new TextEncoder();
export async function tokenHash(token) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function key(secret) { return crypto.subtle.importKey("raw", bytes.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
export async function signProbe(secret, token) {
  const timestamp = String(Date.now());
  const signature = await crypto.subtle.sign("HMAC", await key(secret), bytes.encode(`${timestamp}:${await tokenHash(token)}`));
  return `${timestamp}.${[...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export async function isAdminProbe(secret, token, proof = "") {
  const [timestamp, signature] = proof.split(".");
  if (!/^\d{13}$/.test(timestamp || "") || !/^[0-9a-f]{64}$/.test(signature || "") || Math.abs(Date.now() - Number(timestamp)) > 60000) return false;
  return crypto.subtle.verify("HMAC", await key(secret), Uint8Array.from(signature.match(/../g).map((part) => parseInt(part, 16))), bytes.encode(`${timestamp}:${await tokenHash(token)}`));
}
