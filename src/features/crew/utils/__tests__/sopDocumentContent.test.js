import { describe, expect, it } from "vitest";
import { parseSopBody, sanitizeSopHtml, serializeSopBody, sopBodyPlainText } from "../sopDocumentContent.js";

describe("SOP document content safety", () => {
  it("keeps supported rich text and removes scripts, event handlers and unsafe links", () => {
    const value = sanitizeSopHtml('<div><p onclick="steal()"><strong>Safe</strong><script><img src=x onerror=steal()>alert(1)</script><a href="javascript:steal()">bad</a><a href="https://feedx.test">good</a></p></div>');
    expect(value).toContain("<strong>Safe</strong>");
    expect(value).not.toContain("script");
    expect(value).not.toContain("onclick");
    expect(value).not.toContain("javascript:");
    expect(value).not.toContain("<img");
    expect(value).toContain('href="https://feedx.test"');
    expect(value).toContain('rel="noopener noreferrer"');
  });

  it("stores key point content separately inside the safe document envelope", () => {
    const stored = serializeSopBody("<p>Normal section content.</p>", "Important reminder.");
    const parsed = parseSopBody(stored);
    expect(parsed.html).toBe("<p>Normal section content.</p>");
    expect(parsed.keyPointContent).toBe("Important reminder.");
    expect(sopBodyPlainText(stored)).toBe("Normal section content. Important reminder.");
  });

  it("safely decodes a PostgREST-escaped document envelope before editing", () => {
    const parsed = parseSopBody('&lt;p&gt;&lt;strong&gt;Normal&lt;/strong&gt;&lt;/p&gt;&lt;aside data-feedx-key-point=&quot;true&quot;&gt;&lt;p&gt;Remember this.&lt;/p&gt;&lt;/aside&gt;');
    expect(parsed.html).toBe("<p><strong>Normal</strong></p>");
    expect(parsed.keyPointContent).toBe("Remember this.");
  });

  it("repairs a mixed escaped and real key-point envelope without duplicating it into content", () => {
    const parsed = parseSopBody('<p>&lt;aside data-feedx-key-point="true"&gt;&lt;p&gt;Remember this.&lt;/p&gt;&lt;/aside&gt;</p><aside data-feedx-key-point="true"><p>Remember this.</p></aside>', true);
    expect(parsed.html).toBe("");
    expect(parsed.keyPointContent).toBe("Remember this.");
  });

  it("never includes image data URLs in the serialized rich-text allowlist", () => {
    const stored = serializeSopBody('<p>Text</p><img src="data:image/png;base64,unsafe">', "");
    expect(stored).not.toContain("data:image");
    expect(stored).not.toContain("<img");
  });
});
