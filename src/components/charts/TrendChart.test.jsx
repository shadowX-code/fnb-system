import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import TrendChart from "./TrendChart.jsx";

it("breaks line and area paths at missing months and plots recorded zero", () => {
  const { container } = render(<TrendChart preserveGaps type="area" labels={["Jan", "Feb", "Mar", "Apr"]}
    series={[{ name: "Revenue", data: [0, null, 30, 50], stroke: "green" }]} />);
  const lines = [...container.querySelectorAll('path[stroke="green"]')];
  expect(lines).toHaveLength(2);
  expect(lines[0].getAttribute("d")).toMatch(/^M 0 [\d.]+$/);
  expect(lines[1].getAttribute("d")).toMatch(/^M 66\.\d+ [\d.]+ C /);
  expect(container.querySelectorAll("circle")).toHaveLength(3);
});

it("renders a genuine zero-only series as evidence", () => {
  const { container } = render(<TrendChart preserveGaps labels={["Jan", "Feb"]}
    series={[{ name: "Revenue", data: [0, null], stroke: "green" }]} />);
  expect(screen.queryByText("Not enough saved monthly records yet")).toBeNull();
  expect(container.querySelectorAll("circle")).toHaveLength(1);
});
