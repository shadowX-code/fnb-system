import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FactoryMestiCleaningMethodField, FactoryMestiCleaningMethodReference } from "../FactoryMestiCleaningMethod.jsx";
import { cleaningMethodsFixture as methods } from "./cleaningMethodsFixture.js";
afterEach(cleanup);

it("selects exactly one canonical method and shows only its supplied read-only reference", () => {
  function Harness() { const [draft,setDraft]=useState({});return <FactoryMestiCleaningMethodField draft={draft} methods={methods} onChange={cleaning_method=>setDraft({cleaning_method})}/>; }
  render(<Harness/>);
  for(const method of methods){
    fireEvent.click(screen.getByRole("button",{name:"Cleaning Method"}));
    fireEvent.click(screen.getByRole("option",{name:method.name,exact:true}));
    expect(screen.getByRole("button",{name:"Cleaning Method"}).textContent).toContain(method.name);
    expect(screen.getByText(`Method: ${method.name}`)).toBeTruthy();
    expect(screen.getByText(method.steps[0])).toBeTruthy();
    expect(screen.getByText("Visual Inspection")).toBeTruthy();
  }
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

it("does not infer a method from missing legacy evidence or replace frozen reference text", () => {
  const {rerender}=render(<FactoryMestiCleaningMethodReference/>);
  expect(screen.getByText("Method: Not Specified")).toBeTruthy();
  rerender(<FactoryMestiCleaningMethodReference reference={{...methods[0],steps:["Pinned original procedure"]}}/>);
  expect(screen.getByText("Pinned original procedure")).toBeTruthy();
  expect(screen.queryByText(methods[0].steps[0])).toBeNull();
});
