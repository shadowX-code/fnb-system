import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CrewSopDocument from "../CrewSopDocument.jsx";
import { serializeSopBody } from "../../utils/sopDocumentContent.js";

afterEach(cleanup);

describe("shared Crew SOP document", () => {
  it("renders ordered rich sections and icon-only key point callouts", () => {
    const { container } = render(<CrewSopDocument sections={[
      { id: "two", title: "Second", sort_order: 2, body: "<p>Second body</p>" },
      { id: "one", title: "First", sort_order: 1, body: serializeSopBody("<p><strong>First body</strong></p>", "Keep the workstation ready.") },
    ]} />);

    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["First", "Second"]);
    expect(container.querySelector("strong")?.textContent).toBe("First body");
    expect(screen.getByLabelText("Key point").textContent).toBe("Keep the workstation ready.");
    expect(screen.queryByText("Key Point")).toBeNull();
    expect(container.querySelectorAll(".crew-sop-reader-number")[0].textContent).toContain("01");
  });

  it("renders durable images and captions inside the same document flow", () => {
    render(<CrewSopDocument admin sections={[{
      id: "image-section",
      title: "Uniform",
      sort_order: 1,
      body: "<p>Wear a clean uniform.</p>",
      media: { id: "media-1", previewUrl: "blob:sop-image", caption: "Approved uniform example", width: 900, height: 600 },
    }]} />);

    expect(screen.getByRole("img", { name: "Approved uniform example" }).getAttribute("src")).toBe("blob:sop-image");
    expect(screen.getByText("Approved uniform example").tagName).toBe("FIGCAPTION");
  });

  it("supports long documents and gives empty versions a clear state", () => {
    const sections = Array.from({ length: 12 }, (_, index) => ({
      id: `section-${index}`,
      title: `Section ${index + 1}`,
      sort_order: index + 1,
      body: `<p>${"Long readable content ".repeat(8)}</p>`,
    }));
    const { rerender } = render(<CrewSopDocument sections={sections} />);
    expect(screen.getAllByRole("heading")).toHaveLength(12);
    expect(screen.getByText("Section 12")).not.toBeNull();

    rerender(<CrewSopDocument sections={[]} />);
    expect(screen.getByText("No content yet")).not.toBeNull();
    expect(screen.getByText("This SOP has no content in this version.")).not.toBeNull();
  });
});
