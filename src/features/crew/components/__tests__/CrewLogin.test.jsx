import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../../../../i18n/index.js";
import CrewLogin from "../CrewLogin.jsx";

afterEach(cleanup);

describe("Crew login presentation", () => {
  it("uses FeedX Crew as the pre-auth identity", () => {
    render(<CrewLogin onSignedIn={() => {}} />);
    expect(screen.getByRole("heading", { name: /Welcome to FeedX Crew/ })).not.toBeNull();
    expect(screen.getByAltText("FeedX").getAttribute("src")).toBe("/crew-login-logo-horizontal.png");
  });

  it("does not use outlet guesses while preserving the mobile sign-in flow", () => {
    render(<CrewLogin outletName="Hola Hola Kopitiam Ipoh" onSignedIn={() => {}} />);
    expect(screen.getByRole("heading", { name: /Welcome to FeedX Crew/ })).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Mobile Number" }), { target: { value: "12 345 6789" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).not.toBeNull();
  });
});
