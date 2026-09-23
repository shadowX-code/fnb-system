import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../../i18n/index.js";
import { crewService } from "../../../../services/crewService.js";
import CrewLogin from "../CrewLogin.jsx";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });

describe("Crew login presentation", () => {
  it("uses the new pre-auth hero without guessing an outlet", () => {
    render(<CrewLogin onSignedIn={() => {}} />);
    expect(screen.getByRole("heading", { name: "Let’s make today a good one." })).not.toBeNull();
    expect(screen.getByText("Your day starts here.")).not.toBeNull();
    expect(screen.getByAltText("FeedX").getAttribute("src")).toBe("/crew-login-logo-horizontal.png");
    const artwork = document.querySelector(".crew-auth-artwork");
    expect(artwork?.getAttribute("aria-hidden")).toBe("true");
    expect(artwork?.querySelector(".is-light")?.getAttribute("src")).toBe("/crew-auth-kopitiam-light.png");
    expect(artwork?.querySelector(".is-dark")?.getAttribute("src")).toBe("/crew-auth-kopitiam-dark.png");
  });

  it("does not use outlet guesses while preserving the mobile sign-in flow", () => {
    render(<CrewLogin outletName="Hola Hola Kopitiam Ipoh" onSignedIn={() => {}} />);
    expect(screen.getByRole("heading", { name: "Let’s make today a good one." })).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Mobile Number" }), { target: { value: "12 345 6789" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).not.toBeNull();
  });

  it("has one fixed Malaysia prefix and submits the existing normalized number", async () => {
    const signIn = vi.spyOn(crewService, "signIn").mockResolvedValue({ token: "test" });
    const onSignedIn = vi.fn();
    render(<CrewLogin onSignedIn={onSignedIn} />);
    expect(screen.getByText("+60")).not.toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Mobile Number" }).getAttribute("aria-describedby")).toBe("crew-auth-country-code");
    fireEvent.change(screen.getByRole("textbox", { name: "Mobile Number" }), { target: { value: "012 345 6789" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    for (const digit of "1234") fireEvent.click(screen.getByRole("button", { name: digit }));
    expect(signIn).toHaveBeenCalledWith("+6012 345 6789", "1234");
    signIn.mockRestore();
  });

  it.each([
    ["en", "Let’s make today a good one.", "Your day starts here."],
    ["zh-CN", "一起把今天过好。", "从这里开始新的一天。"],
    ["ms", "Jom jadikan hari ini lebih baik.", "Hari anda bermula di sini."],
  ])("renders the %s login hero without fallback copy", async (language, headline, support) => {
    await i18n.changeLanguage(language);
    render(<CrewLogin onSignedIn={() => {}} />);
    expect(screen.getByRole("heading", { name: headline })).not.toBeNull();
    expect(screen.getByText(support)).not.toBeNull();
  });
});
