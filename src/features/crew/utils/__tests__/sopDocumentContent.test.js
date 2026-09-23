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

  it("cleans nested content before unwrapping an unsafe link", () => {
    const clean = sanitizeSopHtml('<a href="javascript:alert(1)"><span data-feedx-text-tone="teal" onclick="bad()">Keep</span><script>alert(2)</script></a>');
    expect(clean).toBe('<span data-feedx-text-tone="teal">Keep</span>');
  });

  it("converts common formatted paste into the approved HTML grammar", () => {
    const clean = sanitizeSopHtml('<div style="font-size:24px"><p><span style="background-color:#fff"><b>Step</b></span> <a href="https://feedx.my" style="color:red">link</a></p></div>');
    expect(clean).toContain('<mark><b>Step</b></mark>');
    expect(clean).toContain('href="https://feedx.my"');
    expect(clean).not.toContain('style=');
  });

  it("retains only approved semantic colours and underline across Section serialization", () => {
    const stored = serializeSopBody('<p><u>Underlined</u> <span data-feedx-text-tone="teal" style="font-size:44px" onclick="bad()">Teal</span> <span data-feedx-text-tone="purple">Plain</span> <mark data-feedx-highlight="mint" style="color:red">Mint</mark></p>', "Key point");
    expect(stored).toContain("<u>Underlined</u>");
    expect(stored).toContain('data-feedx-text-tone="teal"');
    expect(stored).toContain('data-feedx-highlight="mint"');
    expect(stored).toContain("Plain");
    expect(stored).not.toContain("purple");
    expect(stored).not.toContain("onclick");
    expect(stored).not.toContain("font-size");
    expect(parseSopBody(stored).keyPointContent).toBe("Key point");
  });
});
