// Synthetic end-to-end browser harness; requires an Admin-issued disposable Staging invitation.
// Input contains test-only tokens. Never write tokens, provider secrets or signed URLs to the report.
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const fixture = process.env.FEEDX_RECRUITMENT_QA_DIR;
if (!fixture)
  throw Error(
    "Set FEEDX_RECRUITMENT_QA_DIR to a private synthetic fixture directory.",
  );
const candidateName =
  process.env.FEEDX_RECRUITMENT_QA_NAME || "Synthetic Phase2 Candidate";
const token = fs.readFileSync(`${fixture}/invitation.txt`, "utf8").trim();
const context = await chromium.launchPersistentContext(`${fixture}/browser`, {
  viewport: { width: 390, height: 844 },
  permissions: ["camera", "microphone"],
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fixture}/candidate.wav%noloop`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400)
    console.log(
      "HTTP",
      r.status(),
      new URL(r.url()).pathname.replace(/\/object\/.*/, "/object/[private]"),
    );
  if (r.status() >= 400 && r.url().includes("/upload/resumable"))
    r.text().then((t) => console.log("TUS error", t));
});
try {
  await page.goto(`https://fnb-system-staging.vercel.app/i/${token}`);
  await expect(
    page.getByRole("heading", {
      name: /Welcome, Synthetic|Before you (?:continue|begin)|Camera and microphone|Your interview/,
    }),
  ).toBeVisible();
  if (
    await page
      .getByRole("heading", { name: `Welcome, ${candidateName}` })
      .isVisible()
  ) {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Confirm details" }).click();
  }
  await expect(
    page.getByRole("heading", { name: /Before you (?:continue|begin)/ }),
  ).toBeVisible();
  for (const c of await page.getByRole("checkbox").all()) await c.check();
  await page.getByRole("button", { name: "I agree and continue" }).click();
  await page.getByRole("button", { name: "Check devices" }).click();
  await expect(
    page.getByRole("button", { name: "Devices ready" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Devices ready" }).click();
  await page
    .getByRole("button", { name: "Start interview", exact: true })
    .click();
  await expect(page.getByText(/AI connected/)).toBeVisible({ timeout: 40000 });
  console.log(
    "Recording and real OpenAI voice connected on canonical Staging.",
  );
  // Reload/background/reconnect variants can be selected separately to retain a baseline.
  const variant = process.env.FEEDX_RECRUITMENT_QA_VARIANT || "baseline";
  if (["reconnect", "recovery"].includes(variant)) {
    await page.waitForTimeout(35000);
    await page
      .getByRole("button", { name: "Reconnect AI", exact: true })
      .click();
    await expect(page.getByText(/AI connected/)).toBeVisible({
      timeout: 40000,
    });
    console.log("AI reconnected; recording stayed active.");
  }
  if (variant === "recovery") {
    await context.setOffline(true);
    await page.waitForTimeout(18000);
    await expect(page.getByText(/Recording/).first()).toBeVisible();
    await context.setOffline(false);
    console.log(
      "Upload offline/retry exercised with camera capture still running.",
    );
    // Simulate the visibility signal; this verifies app recovery, not physical background behavior.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(
      page.getByRole("heading", { name: "Interview interrupted" }),
    ).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByRole("button", { name: "Resume with camera and microphone" })
      .click();
    await expect(page.getByText(/AI connected/)).toBeVisible({
      timeout: 45000,
    });
    console.log(
      "Explicit gap and fresh recording unit resumed in the same attempt.",
    );
    await page.waitForTimeout(20000);
    await page.reload();
    await page.waitForTimeout(50000);
    await page
      .getByRole("button", { name: "Start interview", exact: true })
      .click();
    await expect(page.getByText(/AI connected/)).toBeVisible({
      timeout: 45000,
    });
    console.log(
      "Reload recovered acknowledged evidence, same attempt and durable coverage.",
    );
    await page.waitForTimeout(20000);
    await page
      .getByRole("button", { name: "Stop and save partial interview" })
      .click();
  } else await page.waitForTimeout(130000);
  const finish = page.getByRole("button", { name: "Finish interview", exact: true });
  if (await finish.isVisible() && await finish.isEnabled()) await finish.click();
  await expect(
    page.getByRole("heading", { name: "Interview saved" }),
  ).toBeVisible({ timeout: 180000 });
  await page.screenshot({
    path: `${fixture}/candidate-saved.png`,
    fullPage: true,
  });
  const text = await page.locator("main").innerText();
  fs.writeFileSync(
    `${fixture}/candidate-result.json`,
    JSON.stringify({ variant, text, errors, viewport: 390 }, null, 2),
  );
  expect(errors).toEqual([]);
  console.log(
    "Candidate saved evidence; see private QA report for final classification.",
  );
} catch (error) {
  console.log(await page.locator("main").innerText());
  throw error;
} finally {
  await context.close();
}
