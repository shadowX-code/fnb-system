import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
const qa = vi.hoisted(() => ({invoke: vi.fn()}));
vi.mock("../../lib/supabase.ts", () => ({supabase: {functions: qa}}));
import RecruitmentVoiceLab from "./RecruitmentVoiceLab.jsx";
beforeEach(() => {
  qa.invoke.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:fixed-sample"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => {cleanup(); vi.restoreAllMocks();});
it("plays binary audio and replays locally without a second provider request", async () => {
  qa.invoke.mockResolvedValue({data: new Blob([new Uint8Array(48)], {type: "application/octet-stream"}), error: null});
  render(<RecruitmentVoiceLab onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", {name: "Play Voice A marin"}));
  const replay = await screen.findByRole("button", {name: "Replay Voice A marin"});
  await waitFor(() => expect(replay.disabled).toBe(false)); fireEvent.click(replay);
  await waitFor(() => expect(qa.invoke).toHaveBeenCalledOnce());
  expect(qa.invoke.mock.calls[0][1].body).toEqual({voice: "marin", language: "en"});
  expect(URL.createObjectURL.mock.calls[0][0].type).toBe("audio/wav");
});
it("language change cancels and fences a late sample, and failures expose a working retry", async () => {
  let settle; qa.invoke.mockReturnValueOnce(new Promise(resolve => {settle = resolve;}));
  render(<RecruitmentVoiceLab onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", {name: "Play Voice A marin"}));
  const signal = qa.invoke.mock.calls[0][1].signal;
  fireEvent.click(screen.getByRole("tab", {name: "Cantonese"})); expect(signal.aborted).toBe(true);
  settle({data: new Blob([new Uint8Array(48)]), error: null});
  await waitFor(() => expect(screen.getByRole("button", {name: "Play Voice A marin"}).disabled).toBe(false));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  qa.invoke.mockResolvedValueOnce({error: {context: {json: async () => ({error: "Recruitment management access is required."})}}});
  fireEvent.click(screen.getByRole("button", {name: "Play Voice A marin"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Recruitment management access is required.");
  expect(screen.getByRole("button", {name: "Play Voice A marin"}).disabled).toBe(false);
});
