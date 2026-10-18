import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, BookOpen, ThumbsUp, ThumbsDown } from "lucide-react";
import {handoffHints,assistanceLabel} from '../../../supabase/functions/_shared/inboxAssistance.mjs';
import {aiSuggestionUnavailable,faqPreviewMessage,aiSourceLabel} from "./inboxKnowledge.js";
import SelectField from '../../components/forms/SelectField.jsx';
import { replyAvailability } from "./inboxPresentation.js";
export default function InboxReplyComposer({
  current,
  configuration,
  can,
  busy,
  command,
  suggest,
  reviewAI,
  feedbackAI,
  preview,
  faqPreview,
  onSend,
  onDirectSend,
  draftCache,
}) {
  const c = current.conversation;
  const latestSentAt = Math.max(0,...(current.outbox || []).filter(o=>['sent','delivered','read'].includes(o.state)&&o.sent_at).map(o=>Date.parse(o.sent_at)));
  const draft = current.drafts?.find(
    (d) =>
      d.source_version === c.version &&
      (!d.created_at || Date.parse(d.created_at)>latestSentAt) &&
      ["draft", "review", "approved"].includes(d.status) &&
      !["sent", "delivered", "read", "pending", "reconciling"].includes(
        current.outbox?.find((o) => o.draft_id === d.id)?.state,
      ),
  );
  // Drafts remain in session memory only; the parent clears them on staff/Brand scope changes.
  const localCache = useRef(new Map());
  const cache = draftCache || localCache.current;
  const restore = () => {
    const saved = cache.get(c.id);
    const mode = saved?.mode || 'reply';
    return { mode, ...(saved?.[mode] || {text: mode === 'reply' ? draft?.body || '' : '', dirty: false, sourceArtifact: null}) };
  };
  const [editor, setEditor] = useState(restore);
  const editorRef = useRef(editor);
  const {text,mode,dirty,sourceArtifact} = editor;
  function remember(next) {
    editorRef.current = next;
    const previous = cache.get(c.id) || {};
    cache.set(c.id, {...previous, mode: next.mode, [next.mode]: {text:next.text,dirty:next.dirty,sourceArtifact:next.sourceArtifact}});
    if (cache.size > 25) cache.delete(cache.keys().next().value);
    setEditor(next);
  }
  const setText = text => remember({...editorRef.current,text});
  const setDirty = dirty => remember({...editorRef.current,dirty});
  const setSourceArtifact = sourceArtifact => remember({...editorRef.current,sourceArtifact});
  function switchMode(mode) {
    if (editorRef.current.mode === mode) return;
    const saved = cache.get(c.id)?.[mode];
    remember({mode,...(saved || {text:mode==='reply'?draft?.body||'':'',dirty:false,sourceArtifact:null})});
  }
  const previousConversation = useRef(c.id);
  useEffect(() => {
    if (previousConversation.current !== c.id) {
      previousConversation.current = c.id;
      const next = restore();editorRef.current = next;setEditor(next);
    } else if (!editorRef.current.dirty && editorRef.current.mode === 'reply') {
      remember({...editorRef.current,text:draft?.body||'',sourceArtifact:null});
    }
  }, [c.id,draft?.id]);
  const exact = draft && text === draft.body;
  const unavailable = replyAvailability(current, configuration, can("send"));
  const suggestion = current.artifacts?.find(
    (a) =>
      a.kind === "reply" &&
      a.state === "proposed" &&
      a.source_version === c.version,
  );
  const feedback=current.ai_feedback?.find(f=>f.artifact_id===suggestion?.id);
  const setupHref=c.brand_id?`/marketing/faq-ai?marketing_brand=${c.brand_id}`:null;
  const outbox = current.outbox?.find((o) => o.draft_id === draft?.id);
  const faqQuestion = [...(current.messages||[])].reverse().find(m=>m.kind==='incoming'||(c.channel==='internal'&&m.kind==='note'))?.body||'';
  const faqUnavailable = !faqQuestion.trim() ? 'A customer question is needed. Internal cases can use a team note as a test question.' : faqQuestion.length>500 ? 'This message exceeds the 500-character FAQ matching limit. Review the FAQ Library instead.' : '';
  const aiUnavailable = aiSuggestionUnavailable(current,configuration);
  const linkedSuggestion=current.artifacts?.find(a=>a.id===sourceArtifact);
  const draftNeedsReview=draft?.source_references?.some(r=>r?.human_required===true);
  const requiresApproval = current.reply_requires_approval !== false || linkedSuggestion?.body.human_required===true || draftNeedsReview;
  const handoff=[...new Set([...(c.escalation_reasons||[]),...handoffHints(faqQuestion)])];
  const directReady =
    !requiresApproval &&
    text.trim().length > 0 &&
    text.length <= 2000 &&
    !unavailable &&
    can("reply") &&
    !current.outbox?.some((o) =>
      ["prepared", "pending", "reconciling"].includes(o.state),
    );
  const sendReady =
    exact &&
    draft.status === "approved" &&
    !unavailable &&
    ["blocked", "prepared"].includes(outbox?.state || "blocked");
  async function save() {
    const result = await command(mode === "note" ? "note" : "draft", {
      body: text,
      ...(mode==='reply'&&sourceArtifact?{source_artifact:sourceArtifact}:{}),
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
              switchMode("reply");
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
              switchMode("note");
            }}
          >
            Internal note
          </button>
        )}
        <span className="inbox-tool-spacer" />
        {mode === "reply" && can("ai") && (
          <button
            className="btn-secondary"
            disabled={busy || Boolean(aiUnavailable)}
            title={aiUnavailable||"Prepare a grounded suggestion for staff review"}
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
              busy || Boolean(faqUnavailable)
            }
            title={faqUnavailable||'Match the current question to an approved answer'}
            onClick={()=>faqPreview(faqQuestion)}
          >
            <BookOpen size={14} />
            FAQ suggestions
          </button>
        )}
      </div>
      {mode === "reply" && can("ai") && aiUnavailable && <p className="inbox-assistance-status" role="status">{aiUnavailable} {can('configure')&&setupHref?<a href={setupHref}>Open FAQ & AI settings</a>:null}</p>}
      {mode === "reply" && !suggestion && handoff.length>0 && <div className="inbox-assistance-handoff" role="status"><strong>Needs Human Attention</strong><p>{handoff.map(reason=>reason.replaceAll('_',' ')).join(' · ')}. Use the existing assignment or handling controls; AI never assigns or sends.</p></div>}
      {mode === "reply" && suggestion && (
        <section className="inbox-suggestion" aria-label="AI suggested reply">
          <div className="inbox-assistance-heading"><strong>{assistanceLabel(suggestion.body.classification)}</strong><small>{suggestion.body.match_source==='deterministic'?(suggestion.body.matched_faq_ids?.length?'FAQ match · no AI tokens':'Staff handling · no AI tokens'):'Suggest only'}</small></div>
          <p>{suggestion.body.text}</p>
          {suggestion.body.handoff_reasons?.length>0 && <p className="inbox-assistance-status">Staff review: {suggestion.body.handoff_reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}</p>}
          {suggestion.body.unresolved_questions?.length>0 && <details><summary>Needs confirmation ({suggestion.body.unresolved_questions.length})</summary><ul>{suggestion.body.unresolved_questions.map((question,i)=><li key={i}>{question}</li>)}</ul></details>}
          {suggestion.body.matches?.some(match=>match.use_issue) && <details><summary>Related FAQs need confirmation</summary><ul>{suggestion.body.matches.filter(match=>match.use_issue).map(match=><li key={match.id}>{match.question} · {match.use_issue}</li>)}</ul></details>}
          {suggestion.body.sources?.length>0 && <details><summary>Sources ({suggestion.body.sources.length})</summary><ul>{suggestion.body.sources.map(source=><li key={source.key}>{aiSourceLabel(source)} · {source.label}</li>)}</ul></details>}
          <div className="marketing-inbox-actions">
            {can("reply") && <button className="btn-secondary" disabled={busy} onClick={()=>{setText(suggestion.body.text);setDirty(true);setSourceArtifact(suggestion.id);}}>Use Reply</button>}
            {can('ai') && <button className="inbox-text-button" disabled={busy||Boolean(aiUnavailable)} onClick={()=>suggest(suggestion.id)}>Regenerate</button>}
            <button className="inbox-text-button" disabled={busy} onClick={()=>reviewAI(suggestion.id,false)}>Dismiss</button>
          </div>
          {can('ai')&&feedbackAI?<div className="inbox-ai-feedback" aria-label="Suggestion feedback"><span>Was this helpful?</span><button type="button" className="inbox-text-button" aria-pressed={feedback?.helpful===true} disabled={busy} onClick={()=>feedbackAI(suggestion.id,true,null)}><ThumbsUp size={14}/>Helpful</button><button type="button" className="inbox-text-button" aria-pressed={feedback?.helpful===false} disabled={busy} onClick={()=>feedbackAI(suggestion.id,false,null)}><ThumbsDown size={14}/>Not Helpful</button>{feedback?.helpful===false?<SelectField label="What could improve?" value={feedback.reason||''} disabled={busy} onChange={reason=>feedbackAI(suggestion.id,false,reason||null)} options={[{value:'',label:'Optional reason'},{value:'incorrect_facts',label:'Incorrect facts'},{value:'wrong_outlet',label:'Wrong Outlet'},{value:'missed_question',label:'Missed a question'},{value:'language_tone',label:'Language or tone'},{value:'missing_knowledge',label:'Missing knowledge'},{value:'not_relevant',label:'Not relevant'},{value:'other',label:'Other'}]}/>:null}{feedback?<small role="status">Feedback saved</small>:null}</div>:null}
          <small className="inbox-muted">Review and edit before sending. {suggestion.body.human_required?'Staff approval is required.':''}</small>
        </section>
      )}
      {mode === "reply" && preview && (
        <div className="inbox-suggestion">
          <strong>{preview.faq ? 'Active FAQ suggestion' : 'FAQ suggestions'}</strong>
          {preview.faq?<small>{preview.faq.question} · Brand FAQ Library · {preview.faq.match_method==='published_topic'?'Related question':'Matching question'}</small>:null}
          <p>
            {preview.faq?.answer ||
              faqPreviewMessage(preview)}
          </p>
          {preview.faq && can("reply") && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={async () => {const result=await command("faq_draft", {faq_id:preview.faq.id});if(result){setText(preview.faq.answer);setDirty(false);setSourceArtifact(null);}}}
            >
              Use Reply
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
            : !requiresApproval
              ? "Staff reply · review the text before sending"
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
            requiresApproval &&
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
            requiresApproval &&
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
              disabled={busy || !(requiresApproval ? sendReady : directReady)}
              title={
                unavailable ||
                (requiresApproval
                  ? "This reply requires approval"
                  : "Send this staff reply")
              }
              onClick={async () => {
                if (requiresApproval) onSend(draft);
                else {
                  const result = await onDirectSend(text, sourceArtifact);
                  if (result) {
                    setText("");
                    setDirty(false);
                    setSourceArtifact(null);
                  }
                }
              }}
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
