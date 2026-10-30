import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LabelLayoutEditor from "../LabelLayoutEditor.jsx";
afterEach(cleanup);
it("can replace a dynamic field with shared static text without retaining its binding", () => {
  let value;
  function Fixture() {
    const [definition, set] = useState({
      elements: [
        { type: "text", field: "batch_no", x: 5, y: 5, w: 50, h: 10, size: 3 },
      ],
    });
    value = definition;
    return (
      <LabelLayoutEditor
        definition={definition}
        width={80}
        height={90}
        onChange={set}
      />
    );
  }
  render(<Fixture />);
  fireEvent.click(
    screen.getByText("Content source").closest("label").querySelector("button"),
  );
  fireEvent.click(screen.getByRole("option", { name: "Shared static text" }));
  expect(screen.getByLabelText("Shared template text").value).toBe("New text");
  expect(value.elements[0]).not.toHaveProperty("field");
});
it("moves elements by keyboard and supports adding and removing text", () => {
  const change = vi.fn();
  render(
    <LabelLayoutEditor
      definition={{
        elements: [
          { type: "text", text: "Existing", x: 5, y: 5, w: 30, h: 10, size: 3 },
        ],
      }}
      width={80}
      height={90}
      onChange={change}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Select element 1" }), {
    key: "ArrowRight",
  });
  expect(change.mock.calls[0][0].elements[0].x).toBe(5.5);
  fireEvent.click(screen.getByRole("button", { name: "Text", exact: true }));
  expect(change.mock.calls[1][0].elements).toHaveLength(2);
});
