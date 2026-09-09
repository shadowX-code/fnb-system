import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import PublicHomepage from "../PublicHomepage.jsx";

afterEach(cleanup);

it("keeps the FeedX visual shell while omitting every authentication control", () => {
  render(<PublicHomepage />);

  expect(screen.getByRole("heading", { name: /Smart Operations/i })).toBeTruthy();
  expect(screen.getByText(/All your F&B operations/i)).toBeTruthy();
  expect(screen.getByText("Real-time Intelligence")).toBeTruthy();
  expect(screen.queryByLabelText("Email")).toBeNull();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /forgot password/i })).toBeNull();
  expect(screen.queryByText(/Remember me/i)).toBeNull();
  expect(screen.queryByText(/Operations Center/i)).toBeNull();
});
