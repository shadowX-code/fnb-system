import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CrewRichContent from "../CrewRichContent.jsx";

afterEach(cleanup);

describe("Crew rich learning content", () => {
  it("renders the approved rich-text semantics without trusting raw HTML", () => {
    const { container } = render(
      <CrewRichContent html={'<p><strong>Bold</strong> and <em>italic</em> <mark>highlight</mark></p><ul><li>Bullet</li></ul><ol><li>Numbered</li></ol><a href="https://feedx.test">Guide</a>'} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("mark")?.textContent).toBe("highlight");
    expect(container.querySelectorAll("ul li")).toHaveLength(1);
    expect(container.querySelectorAll("ol li")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Guide" }).getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("removes scripts, iframes, event handlers and unsafe URLs", () => {
    const { container } = render(
      <CrewRichContent html={'<p onclick="steal()">Safe<script>alert(1)</script><iframe src="https://bad.test"></iframe><a href="javascript:steal()">Unsafe</a></p>'} />,
    );
    expect(container.querySelector("script,iframe")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(container.textContent).not.toContain("unsafe()");
    expect(screen.getByText(/Safe/)).not.toBeNull();
  });
});
