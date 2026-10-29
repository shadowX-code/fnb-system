import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ExternalAgentsPage from "./ExternalAgentsPage.jsx";
import { externalAgentService } from "../../services/externalAgentService.js";
vi.mock("../../services/externalAgentService.js", () => ({ externalAgentService: { list: vi.fn(), details: vi.fn(), revoke: vi.fn(), rotate: vi.fn(), test: vi.fn() } }));
const credential = { id: "existing-credential", status: "active", created_at: "2026-10-29T01:00:00Z", expires_at: "2026-11-28T01:00:00Z" };
const agent = { id: "qa", name: "QA Executive", provider: "xAI", enabled: true, role_active: true, role_name: "QA inspection", permission: "factory_mesti_inspection.view", permission_granted: true, workspace: "Factory", scope: "MeSTI compliance · read-only", can_manage: true, credential, connection_status: "not_observed", tools: Array.from({ length: 5 }, (_, i) => ({ name: `read_tool_${i}`, description: "Read evidence", capability: "read", domain: "mesti" })), endpoint: "https://example.test/mcp" };
const detail = { connections: [agent], credentials: [credential], access_events: [{ id: 1, occurred_at: "2026-10-29T01:00:00Z", method: "initialize", source: "admin_probe", outcome: "success" }], history_note: "Earlier history is unavailable." };
const auth = (codes = ["roles.view", "roles.edit"]) => ({ hasPermission: (code) => codes.includes(code) });
beforeEach(() => {
  vi.resetAllMocks();
  externalAgentService.list.mockResolvedValue({ connections: [agent] });
  externalAgentService.details.mockResolvedValue(detail);
  externalAgentService.revoke.mockResolvedValue({ revoked: true });
  externalAgentService.rotate.mockResolvedValue({ one_time_credential: "TEST_ONE_TIME_SECRET", expires_at: credential.expires_at });
  externalAgentService.test.mockResolvedValue({ message: "Endpoint reachable. Authentication is still required." });
});
afterEach(cleanup);
async function open() { fireEvent.click(await screen.findByRole("button", { name: "View QA Executive" })); await screen.findByRole("heading", { name: "Connection" }); }
it("shows credential validity separately from observed connectivity and access-test provenance", async () => {
  render(<ExternalAgentsPage auth={auth()} />);
  expect(await screen.findByText("Active")).toBeTruthy();
  expect(screen.getByText("Not observed")).toBeTruthy();
  await open();
  expect(screen.getAllByText("Read only")).toHaveLength(5);
  expect(screen.getByText("FeedX connection test")).toBeTruthy();
  expect(screen.queryByDisplayValue("TEST_ONE_TIME_SECRET")).toBeNull();
});
it("requires explicit confirmation and renders a one-time credential only after rotation", async () => {
  render(<ExternalAgentsPage auth={auth()} />); await open();
  fireEvent.click(screen.getByRole("button", { name: "Rotate credential" }));
  expect(externalAgentService.rotate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(externalAgentService.rotate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Rotate credential" }));
  fireEvent.click(screen.getByRole("dialog", { name: "Rotate agent credential?" }).querySelector("button:last-child"));
  await screen.findByRole("heading", { name: "Save the new credential" });
  expect(externalAgentService.rotate).toHaveBeenCalledWith("qa", "existing-credential", expect.any(String));
  expect(screen.getByLabelText("New agent credential").type).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "I have saved the credential" }));
  expect(screen.queryByDisplayValue("TEST_ONE_TIME_SECRET")).toBeNull();
});
it("does not revoke until confirmed and passes the exact credential reference", async () => {
  render(<ExternalAgentsPage auth={auth()} />); await open();
  fireEvent.click(screen.getByRole("button", { name: "Revoke", exact: true }));
  expect(externalAgentService.revoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Revoke credential", exact: true }));
  await waitFor(() => expect(externalAgentService.revoke).toHaveBeenCalledWith("qa", "existing-credential"));
});
it("supports Role Settings aliases and hides credential mutation from view-only administrators", async () => {
  render(<ExternalAgentsPage auth={auth(["roles_permissions.view"])} />); await open();
  expect(screen.queryByRole("button", { name: "Rotate credential" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Revoke", exact: true })).toBeNull();
  expect(screen.getByRole("button", { name: "Test endpoint" }).disabled).toBe(true);
});
it("denies visibility without Role Settings and does not fetch connection metadata", () => {
  render(<ExternalAgentsPage auth={auth([])} />);
  expect(screen.getByRole("alert").textContent).toContain("Role Settings view");
  expect(externalAgentService.list).not.toHaveBeenCalled();
});
it("clears a supplied test credential and does not render it in test results", async () => {
  render(<ExternalAgentsPage auth={auth()} />); await open();
  fireEvent.change(screen.getByLabelText(/Agent credential/), { target: { value: "SUPPLIED_SECRET" } });
  fireEvent.click(screen.getByRole("button", { name: "Test supplied credential" }));
  await waitFor(() => expect(externalAgentService.test).toHaveBeenCalledWith("qa", "SUPPLIED_SECRET"));
  expect(screen.queryByDisplayValue("SUPPLIED_SECRET")).toBeNull();
  expect(await screen.findByText("Endpoint reachable. Authentication is still required.")).toBeTruthy();
});
