import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "../../../../i18n/index.js";
import CrewGuestVoice from "../CrewGuestVoice.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { guestVoice: vi.fn() } }));

const feed = () => ({
  status: "ready", rating: 4.2, total: 2, revision: "revision",
  fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString(),
  reviews: [
    { id: "1", reviewer: { displayName: "Casey" }, rating: 5, date: "2026-10-08T00:00:00Z", comment: "Good coffee" },
    { id: "2", reviewer: { displayName: "Jordan" }, rating: 1, date: "2026-10-07T00:00:00Z", comment: "Long wait" },
  ],
});
function motion(matches = false) {
  const listeners = new EventTarget();
  const query = Object.assign(listeners, { matches });
  vi.stubGlobal("matchMedia", () => query);
  return query;
}
const renderFeed = async () => {
  await act(async () => render(<CrewGuestVoice token="crew" outletId="outlet" outletName="Friends Corner" />));
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("rotates at seven seconds and pauses on focus, hidden pages and reduced motion", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const preference = motion();
  crewService.guestVoice.mockImplementation(async () => feed());
  await renderFeed();
  const advance = (ms) => act(async () => vi.advanceTimersByTimeAsync(ms));
  await advance(6999);
  expect(screen.getByText("Good coffee")).toBeTruthy();
  await advance(1);
  expect(screen.getByText("Long wait")).toBeTruthy();
  const dot = screen.getByRole("button", { name: "Review 2 of 2" });
  fireEvent.focus(dot);
  await advance(8000);
  expect(screen.getByText("Long wait")).toBeTruthy();
  fireEvent.blur(dot);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  await advance(8000);
  expect(screen.getByText("Long wait")).toBeTruthy();
  preference.matches = true;
  act(() => preference.dispatchEvent(new Event("change")));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await act(async () => fireEvent(document, new Event("visibilitychange")));
  await advance(8000);
  expect(screen.getByText("Long wait")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Pause reviews" })).toBeNull();
});

it("keeps low ratings in the read-only list and clears expired content", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  motion(true);
  const cached = feed();
  cached.expiresAt = new Date(Date.now() + 1000).toISOString();
  crewService.guestVoice.mockResolvedValue(cached);
  await renderFeed();
  fireEvent.click(screen.getByRole("button", { name: "View all" }));
  const list = screen.getByRole("dialog", { name: "Guest Voice" });
  fireEvent.click(within(list).getByRole("button", { name: /Jordan/ }));
  const detail = screen.getByRole("dialog", { name: "Guest review" });
  expect(within(detail).getByText("Long wait")).toBeTruthy();
  expect(within(detail).getByRole("img", { name: "1 out of 5 stars" })).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Waiting for a fresh Google review sync.")).toBeTruthy();
});
