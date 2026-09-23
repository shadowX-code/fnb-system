import { useEffect, useRef, useState } from "react";
import { Mark } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, Eraser, Highlighter, ImagePlus, Italic, Link2, List,
  ListOrdered, Redo2, Underline, Undo2,
} from "lucide-react";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import { IMAGE_UPLOAD_ACCEPT } from "../../../utils/imageUpload.js";
import { sanitizeSopHtml, SOP_HIGHLIGHTS, SOP_TEXT_TONES } from "../utils/sopDocumentContent.js";
import "./CrewAdminRichTextEditor.css";
import "../../../styles/FeedxRichText.css";

const TextTone = Mark.create({
  name: "feedxTextTone",
  addAttributes() {
    return { tone: { default: null, parseHTML: (element) => element.getAttribute("data-feedx-text-tone"), renderHTML: ({ tone }) => ({ "data-feedx-text-tone": tone }) } };
  },
  parseHTML() { return [{ tag: "span[data-feedx-text-tone]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", HTMLAttributes, 0]; },
});

const Highlight = Mark.create({
  name: "feedxHighlight",
  addAttributes() {
    return { tone: { default: "yellow", parseHTML: (element) => element.getAttribute("data-feedx-highlight") || "yellow", renderHTML: ({ tone }) => ({ "data-feedx-highlight": tone }) } };
  },
  parseHTML() { return [{ tag: "mark" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", HTMLAttributes, 0]; },
});

const extensions = [
  StarterKit.configure({ blockquote: false, code: false, codeBlock: false, heading: false, horizontalRule: false, strike: false, link: { openOnClick: false, autolink: false, linkOnPaste: false } }),
  TextTone,
  Highlight,
];

const TEXT_COLORS = [
  { value: "", label: "Default" },
  { value: "muted", label: "Muted" },
  { value: "teal", label: "FeedX Teal" },
  { value: "warning", label: "Warning" },
  { value: "danger", label: "Danger" },
];
const HIGHLIGHT_COLORS = [
  { value: "", label: "None" },
  { value: "mint", label: "Mist Mint" },
  { value: "yellow", label: "Soft Yellow" },
  { value: "red", label: "Soft Red" },
  { value: "info", label: "Soft Info Blue" },
];
const safeHref = (value) => /^(https?:|mailto:|tel:)/i.test(value.trim());

function ToolButton({ label, Icon, active = false, disabled = false, onClick }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}><Icon size={16} aria-hidden="true" /></button>;
}

export default function CrewAdminRichTextEditor({ value = "", onChange, onImage, disabled = false, placeholder = "Write content…", imageActionLabel = "Add or replace section image", imageInputId }) {
  const onChangeRef = useRef(onChange);
  const lastValueRef = useRef(sanitizeSopHtml(value));
  const imageRef = useRef(null);
  const selectionRef = useRef(null);
  const [revision, setRevision] = useState(0);
  const [palette, setPalette] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions,
    content: sanitizeSopHtml(value),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "admin-rich-text-surface", role: "textbox", "aria-label": "Content", "aria-multiline": "true", "data-placeholder": placeholder },
      transformPastedHTML: (html) => sanitizeSopHtml(html),
    },
    onUpdate: ({ editor: current }) => {
      const next = sanitizeSopHtml(current.getHTML());
      if (next !== lastValueRef.current) {
        lastValueRef.current = next;
        onChangeRef.current?.(next);
      }
    },
    onTransaction: () => setRevision((current) => current + 1),
  });

  useEffect(() => { if (editor) editor.setEditable(!disabled); }, [editor, disabled]);
  useEffect(() => {
    if (!editor) return;
    const next = sanitizeSopHtml(value);
    if (sanitizeSopHtml(editor.getHTML()) !== next) editor.commands.setContent(next, { emitUpdate: false });
    lastValueRef.current = next;
  }, [editor, value]);

  function openLink() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    selectionRef.current = { from, to };
    setLinkUrl(editor.getAttributes("link").href || "");
    setLinkText(empty ? "" : editor.state.doc.textBetween(from, to));
    setLinkError("");
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const href = linkUrl.trim();
    if (!safeHref(href)) { setLinkError("Use an http(s), mailto, or tel link."); return; }
    const chain = editor.chain().focus().setTextSelection(selectionRef.current || editor.state.selection);
    if (selectionRef.current?.from === selectionRef.current?.to && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: linkText.trim() || href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain.extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }

  function colorMenu(kind, options, activeValue, apply) {
    return <ActionMenu open={palette === kind} onOpenChange={(open) => { if (open) selectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to }; setPalette(open ? kind : ""); }} align="left" width={184} ariaLabel={kind} trigger={({ toggle }) => <ToolButton label={kind} Icon={kind === "Text Color" ? Bold : Highlighter} active={Boolean(activeValue)} disabled={disabled || !editor} onClick={toggle} />}>
      <div role="menu" aria-label={kind} className="admin-rich-text-palette">{options.map(({ value: tone, label }) => <button key={label} type="button" role="menuitemradio" aria-checked={activeValue === tone} onMouseDown={(event) => event.preventDefault()} onClick={() => { apply(tone); setPalette(""); }}><span className={`admin-rich-text-swatch ${kind === "Text Color" ? "is-text" : "is-highlight"}`} data-tone={tone || "default"} aria-hidden="true">A</span>{label}</button>)}</div>
    </ActionMenu>;
  }

  const ready = Boolean(editor);
  const textTone = editor?.getAttributes("feedxTextTone").tone || "";
  const highlightTone = editor?.getAttributes("feedxHighlight").tone || "";
  void revision;
  return <div className={`admin-rich-text-editor ${disabled ? "is-disabled" : ""}`}>
    <div className="admin-rich-text-toolbar" role="toolbar" aria-label="Content formatting">
      <div className="admin-rich-text-tool-group">
        <ToolButton label="Bold" Icon={Bold} active={editor?.isActive("bold")} disabled={disabled || !ready} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton label="Italic" Icon={Italic} active={editor?.isActive("italic")} disabled={disabled || !ready} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton label="Underline" Icon={Underline} active={editor?.isActive("underline")} disabled={disabled || !ready} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        {colorMenu("Text Color", TEXT_COLORS, textTone, (tone) => tone && SOP_TEXT_TONES.includes(tone) ? editor.chain().focus().setTextSelection(selectionRef.current).setMark("feedxTextTone", { tone }).run() : editor.chain().focus().setTextSelection(selectionRef.current).unsetMark("feedxTextTone").run())}
        {colorMenu("Highlight", HIGHLIGHT_COLORS, highlightTone, (tone) => tone && SOP_HIGHLIGHTS.includes(tone) ? editor.chain().focus().setTextSelection(selectionRef.current).setMark("feedxHighlight", { tone }).run() : editor.chain().focus().setTextSelection(selectionRef.current).unsetMark("feedxHighlight").run())}
      </div>
      <div className="admin-rich-text-tool-group">
        <ToolButton label="Bullet List" Icon={List} active={editor?.isActive("bulletList")} disabled={disabled || !ready} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolButton label="Numbered List" Icon={ListOrdered} active={editor?.isActive("orderedList")} disabled={disabled || !ready} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      </div>
      <div className="admin-rich-text-tool-group">
        <ToolButton label="Link" Icon={Link2} active={editor?.isActive("link")} disabled={disabled || !ready} onClick={openLink} />
        {onImage ? <ToolButton label={imageActionLabel} Icon={ImagePlus} disabled={disabled || !ready} onClick={() => imageRef.current?.click()} /> : null}
      </div>
      <div className="admin-rich-text-tool-group">
        <ToolButton label="Undo" Icon={Undo2} disabled={disabled || !editor?.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
        <ToolButton label="Redo" Icon={Redo2} disabled={disabled || !editor?.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
        <ToolButton label="Clear Formatting" Icon={Eraser} disabled={disabled || !ready} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
      </div>
      {onImage ? <input id={imageInputId} ref={imageRef} className="sr-only" type="file" tabIndex={-1} aria-hidden="true" aria-label={imageActionLabel} accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImage(file); event.target.value = ""; }} /> : null}
    </div>
    {linkOpen ? <div className="admin-rich-text-link" role="group" aria-label="Edit link">
      {editor?.state.selection.empty && !editor?.isActive("link") ? <input className="control" aria-label="Link text" placeholder="Display text" value={linkText} onChange={(event) => setLinkText(event.target.value)} /> : null}
      <input className="control" aria-label="Link URL" placeholder="https://example.com" value={linkUrl} onChange={(event) => { setLinkUrl(event.target.value); setLinkError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } }} />
      <button type="button" className="btn-secondary" onClick={applyLink}>Apply Link</button>
      {editor?.isActive("link") ? <button type="button" className="btn-ghost" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }}>Remove Link</button> : null}
      <button type="button" className="btn-ghost" onClick={() => setLinkOpen(false)}>Cancel</button>
      {linkError ? <small role="alert">{linkError}</small> : null}
    </div> : null}
    <EditorContent editor={editor} />
  </div>;
}
