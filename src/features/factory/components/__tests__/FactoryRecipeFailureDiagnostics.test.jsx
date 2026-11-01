import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryRecipeFailureDiagnostics from "../FactoryRecipeFailureDiagnostics.jsx";
import { beginRecipeDiagnostic, clearRecipeFailure, getLatestRecipeFailure } from "../../../../services/factoryRecipeDiagnostics.js";

const admin = { isProtectedRole: true, hasPermission: code => code === "factory_product_recipes.view" };
let scope;
afterEach(() => { cleanup(); scope?.end(); clearRecipeFailure(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fail() { scope = beginRecipeDiagnostic(new AbortController().signal); scope.nextAttempt(); scope.fail("read_failure"); }

it("shows nothing for successful reads and exposes export only to a permitted administrator", () => {
  const view = render(<FactoryRecipeFailureDiagnostics auth={admin} />);
  expect(screen.queryByRole("complementary")).toBeNull();
  act(fail);
  expect(screen.getByRole("button", { name: "Export diagnostic report" })).toBeTruthy();
  view.rerender(<FactoryRecipeFailureDiagnostics auth={{ ...admin, isProtectedRole: false }} />);
  expect(screen.queryByRole("button", { name: "Export diagnostic report" })).toBeNull();
  view.rerender(<FactoryRecipeFailureDiagnostics auth={{ ...admin, hasPermission: () => false }} />);
  expect(screen.queryByRole("button", { name: "Export diagnostic report" })).toBeNull();
});

it("downloads the actual latest report, revokes its object URL and supports explicit clearing", () => {
  fail();
  const urls = { createObjectURL: vi.fn().mockReturnValue("blob:diagnostic"), revokeObjectURL: vi.fn() };
  vi.stubGlobal("URL", urls);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<FactoryRecipeFailureDiagnostics auth={admin} />);
  fireEvent.click(screen.getByRole("button", { name: "Export diagnostic report" }));
  expect(urls.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(click.mock.instances[0].download).toBe("feedx-recipe-read-failure.json");
  expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:diagnostic");
  fireEvent.click(screen.getByRole("button", { name: "Clear report" }));
  expect(getLatestRecipeFailure()).toBeNull();
  expect(screen.queryByRole("button", { name: "Export diagnostic report" })).toBeNull();
});
