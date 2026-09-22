import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminScopeSwitcher from "../AdminScopeSwitcher.jsx";

afterEach(cleanup);

describe("AdminScopeSwitcher", () => {
  const outlets = [
    { id: "friends", name: "Friends Corner" },
    { id: "hola", name: "Hola Hola Kopitiam Ipoh" },
    { id: "long", name: "A deliberately long authorized outlet name" },
  ];

  it("provides one-click scope changes with an accessible active state", () => {
    const onChange = vi.fn();
    render(<AdminScopeSwitcher ariaLabel="Dashboard outlet" items={outlets} value="friends" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Friends Corner" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hola Hola Kopitiam Ipoh" }));
    expect(onChange).toHaveBeenCalledWith("hola");
  });

  it("supports keyboard movement across direct scopes", () => {
    render(<AdminScopeSwitcher items={outlets} value="friends" onChange={vi.fn()} />);
    const friends = screen.getByRole("button", { name: "Friends Corner" });
    friends.focus();
    fireEvent.keyDown(friends, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Hola Hola Kopitiam Ipoh" }));
  });
});
