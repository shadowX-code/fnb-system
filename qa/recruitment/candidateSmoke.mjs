// Start Vite with dummy VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then run this local smoke.
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  let status = "invited";
  await page.route("**/rest/v1/rpc/recruitment_*", async (route) => {
    const name = route.request().url().split("/").pop();
    if (name === "recruitment_public_confirm_profile") status = "profile_confirmed";
    if (name === "recruitment_public_consent") status = "consented";
    if (name === "recruitment_public_ready") status = "ready";
    const body = {
      available: true,
      job: { title: "Crew Member Opening", position: "Crew Member", workplace: "KL Outlet", company: "FeedX", description: "", candidate_instructions: "Prepare in a quiet room.", target_minutes: 20, max_minutes: 30 },
      profile: { full_name: "Test Candidate", contact: "0123456789" }, status,
      copy_version: "phase1-provisional-v1",
      consent_copy: { ai: "I consent to an AI-conducted interview.", recording: "I consent to camera and microphone recording during the interview.", review: "I consent to authorized recruitment managers reviewing the interview evidence.", notice: "Provisional Phase 1 wording." },
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`http://127.0.0.1:5173/i/${"a".repeat(64)}`);
  await expect(page.getByRole("heading", { name: "Welcome, Test Candidate" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Crew Member Opening" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm details" }).click();
  await expect(page.getByRole("heading", { name: "Before you continue" })).toBeVisible();
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await page.getByRole("button", { name: "I agree and continue" }).click();
  await page.getByRole("button", { name: "Check devices" }).click();
  await expect(page.getByRole("button", { name: "Devices ready" })).toBeEnabled();
  await page.getByRole("button", { name: "Devices ready" }).click();
  await expect(page.getByRole("heading", { name: "Your interview" })).toBeVisible();
  process.stdout.write(`Candidate mobile preparation flow passed (${status}).\n`);
} finally { await browser.close(); }
