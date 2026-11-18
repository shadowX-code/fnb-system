import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { canonicalPathForRoute, resolveCanonicalPath } from "../../app/routeOwnership.js";
import SpaceStationPage from "./SpaceStationPage.jsx";

const { createStation } = vi.hoisted(()=>({createStation:vi.fn()}));
vi.mock("./stationRuntime.js",()=>({createStation}));
let engine;
beforeEach(()=>{
  window.matchMedia=vi.fn(()=>({matches:false}));
  engine={dispose:vi.fn(),focus:vi.fn(),select:vi.fn(),pause:vi.fn()};
  createStation.mockReset().mockImplementation((_host,events)=>{events.ready();return engine;});
});
afterEach(cleanup);

describe("Space Station",()=>{
  it("owns a direct Admin route and returns to the same station after exploring a cabin",async()=>{
    expect(canonicalPathForRoute("space_station")).toBe("/space-station");
    expect(resolveCanonicalPath("/space-station").routeId).toBe("space_station");
    const navigate=vi.fn();
    const {unmount}=render(<SpaceStationPage ui={{navigate,networkRoutes:[{id:"finance_overview"}]}}/>);
    await waitFor(()=>expect(createStation).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button",{name:"Finance Hub"}));
    fireEvent.change(screen.getByLabelText("Inspect cabin"),{target:{value:"screen"}});
    fireEvent.click(screen.getByRole("button",{name:"Open Finance overview"}));
    expect(navigate).toHaveBeenCalledWith("finance_overview");
    fireEvent.click(screen.getByRole("button",{name:"Back to Station"}));
    expect(engine.focus).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button",{name:"Factory Lab"}));
    fireEvent.change(screen.getByLabelText("Inspect cabin"),{target:{value:"equipment"}});
    expect(screen.queryByRole("button",{name:"Open Production Overview"})).toBeNull();
    expect(screen.getByText("Module access required")).toBeTruthy();
    unmount();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });
  it("keeps authorized navigation available after a renderer failure and supports retry",async()=>{
    createStation.mockImplementationOnce(()=>{throw Error("WebGL unavailable");});
    const navigate=vi.fn();
    render(<SpaceStationPage ui={{navigate,networkRoutes:[{id:"marketing_calendar"}]}}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Open Content Management"}));
    expect(navigate).toHaveBeenCalledWith("marketing_calendar");
    expect(screen.queryByRole("button",{name:"Open Finance overview"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Launch 3D view"}));
    await waitFor(()=>expect(createStation).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button",{name:"Directory"}));
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });
});
