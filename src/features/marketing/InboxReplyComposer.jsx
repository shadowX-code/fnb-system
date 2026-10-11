import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, BookOpen, StickyNote } from "lucide-react";
import { replyAvailability } from "./inboxPresentation.js";
export default function InboxReplyComposer({
  current,
  configuration,
  can,
  busy,
  command,
  suggest,
  reviewAI,
  preview,
  faqPreview,
  onSend,
}) {
  const c = current.conversation;
  const draft = current.drafts?.find(
    (d) =>
      d.source_version === c.version &&
      ["draft", "review", "approved"].includes(d.status) &&
      !["sent", "delivered", "read", "pending", "reconciling"].includes(
        current.outbox?.find((o) => o.draft_id === d.id)?.state,
      ),
  );
  const [text, setText] = useState(draft?.body || ""),
    [mode, setMode] = useState("reply"),
    [dirty, setDirty] = useState(false);
  const previousConversation=useRef(c.id);
  useEffect(() => {
    const changed=previousConversation.current!==c.id;
    previousConversation.current=c.id;
    if(changed||!dirty){setText(draft?.body||'');setDirty(false);setMode('reply');}
  }, [c.id, draft?.id]);
  const exact = draft && text === draft.body;
  const unavailable = replyAvailability(current, configuration, can("send"));
  const suggestion = current.artifacts?.find(
    (a) =>
      a.kind === "reply" &&
      a.state === "proposed" &&
      a.source_version === c.version,
  );
  const outbox = current.outbox?.find((o) => o.draft_id === draft?.id);
  const sendReady =
    exact &&
    draft.status === "approved" &&
    !unavailable &&
    ["blocked", "prepared"].includes(outbox?.state || "blocked");
  async function save() {
    const result = await command(mode === "note" ? "note" : "draft", {
      body: text,
    });
    if (result) {
      setText("");
      setDirty(false);
    }
  }
  return (
    <div className="inbox-composer" aria-label="Reply composer">
      <div className="inbox-composer-tools">
        {can("reply") && (
          <button
            className={`inbox-text-button ${mode === "reply" ? "active" : ""}`}
            aria-pressed={mode === "reply"}
            onClick={() => {
              setMode("reply");
              setText(draft?.body || "");
              setDirty(false);
            }}
          >
            Reply
          </button>
        )}
        {can("manage") && (
          <button
            className={`inbox-text-button ${mode === "note" ? "active" : ""}`}
            aria-pressed={mode === "note"}
            onClick={() => {
              setMode("note");
              setText("");
              setDirty(false);
            }}
          >
            <StickyNote size={14} />
            Internal note
          </button>
        )}
        <span className="inbox-tool-spacer" />
        {mode === "reply" && can("ai") && (
          <button
            className="btn-secondary"
            disabled={busy || !configuration?.ai_configured}
            onClick={suggest}
          >
            <Sparkles size={14} />
            AI Suggest
          </button>
        )}
        {mode === "reply" && can("reply") && (
          <button
            className="btn-secondary"
            disabled={
              busy || !current.messages?.some((m) => m.kind === "incoming")
            }
            onClick={() =>
              faqPreview(
                [...current.messages]
                  .reverse()
                  .find((m) => m.kind === "incoming")?.body || "",
              )
            }
          >
            <BookOpen size={14} />
            Approved FAQ
          </button>
        )}
      </div>
      {mode === "reply" && suggestion && (
        <div className="inbox-suggestion" aria-label="AI suggested reply">
          <strong>Suggested reply · needs review</strong>
          <p>{suggestion.body.text}</p>
          {suggestion.body.human_required && (
            <p>A person needs to handle this request.</p>
          )}
          {can("approve") && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => reviewAI(suggestion.id, true)}
            >
              Use reviewed suggestion
            </button>
          )}
          <button
            className="inbox-text-button"
            disabled={busy}
            onClick={() => reviewAI(suggestion.id, false)}
          >
            Dismiss
          </button>
        </div>
      )}
      {mode === "reply" && preview && (
        <div className="inbox-suggestion">
          <strong>Approved FAQ</strong>
          <p>
            {preview.faq?.answer ||
              "No approved answer. Ask a team member to help."}
          </p>
          {preview.faq && can("reply") && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => command("faq_draft", { faq_id: preview.faq.id })}
            >
              Use FAQ
            </button>
          )}
        </div>
      )}
      <label className="sr-only" htmlFor={`inbox-compose-${c.id}`}>
        {mode === "note" ? "Internal note" : "Reply"}
      </label>
      <textarea
        id={`inbox-compose-${c.id}`}
        className="control"
        value={text}
        rows={3}
        maxLength={8000}
        disabled={busy || !(mode === "note" ? can("manage") : can("reply"))}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        placeholder={
          mode === "note" ? "Add a note for your team…" : "Write a reply…"
        }
      />
      <div className="inbox-composer-footer">
        <p role="status">
          {mode === "note"
            ? "Only your team can see this note"
            : exact
              ? draft.status === "approved"
                ? "Reply approved"
                : draft.status === "review"
                  ? "Awaiting approval"
                  : "Draft · not sent"
              : dirty && draft
                ? "Edited reply needs a new approval"
                : "Replies require staff approval"}
          {mode === "reply" && unavailable && <> · {unavailable}</>}
        </p>
        <div className="marketing-inbox-actions">
          {text.trim() && (mode === "note" || !exact) && (
            <button className="btn-secondary" disabled={busy} onClick={save}>
              {mode === "note" ? "Save note" : "Save draft"}
            </button>
          )}
          {mode === "reply" &&
            exact &&
            draft.status === "draft" &&
            can("reply") && (
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => command("review_reply", { draft_id: draft.id })}
              >
                Request approval
              </button>
            )}
          {mode === "reply" &&
            exact &&
            draft.status === "review" &&
            can("approve") && (
              <>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    command("approve_reply", { draft_id: draft.id })
                  }
                >
                  Approve reply
                </button>
                <button
                  className="inbox-text-button"
                  disabled={busy}
                  onClick={() =>
                    command("reject_reply", { draft_id: draft.id })
                  }
                >
                  Reject
                </button>
              </>
            )}
          {mode === "reply" && (
            <button
              className="btn-primary"
              disabled={busy || !sendReady}
              title={
                unavailable || "Send requires this exact reply to be approved"
              }
              onClick={() => onSend(draft)}
            >
              <Send size={14} />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
