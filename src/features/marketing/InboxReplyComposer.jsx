import WhatsAppTemplateCatalog from './WhatsAppTemplateCatalog.jsx';
import {inboxService} from './inboxService.js';
import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, BookOpen, ThumbsUp, ThumbsDown } from "lucide-react";
import {handoffHints,assistanceLabel} from '../../../supabase/functions/_shared/inboxAssistance.mjs';
import {aiSuggestionUnavailable,faqPreviewMessage,aiSourceLabel} from "./inboxKnowledge.js";
import SelectField from '../../components/forms/SelectField.jsx';
import Modal from "../../components/feedback/Modal.jsx";
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
  onTemplateSend,
  draftCache,
  canViewConnections = false,
  handoffVisibleInHeader = false,
  whatsAppStatusUnavailable = false,
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
  const sendInProgress = current.outbox?.some((item) =>
    ["prepared", "pending", "reconciling"].includes(item.state),
  );
  const directReady =
    !requiresApproval &&
    text.trim().length > 0 &&
    text.length <= 2000 &&
    !unavailable &&
    can("reply") &&
    !sendInProgress;
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
  const whatsAppDeadline = c.channel === "whatsapp" ? current.window_expires_at : null;
  const [expiredDeadline, setExpiredDeadline] = useState(null);
  useEffect(() => {
    if (!whatsAppDeadline || !current.window_open) return;
    const remaining = Date.parse(whatsAppDeadline) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = setTimeout(() => setExpiredDeadline(whatsAppDeadline), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [whatsAppDeadline, current.window_open]);
  const [showTemplates, setShowTemplates] = useState(false);
  if (c.channel === "whatsapp") {
    const note = mode === "note";
    const windowOpen = current.window_open && expiredDeadline !== whatsAppDeadline
      && Date.parse(whatsAppDeadline) > Date.now();
    const connectionsHref = `/marketing/connections?provider=whatsapp&marketing_brand=${encodeURIComponent(c.brand_id || '')}&marketing_org=${encodeURIComponent(c.organization_id || '')}`;
    const connectionAction = canViewConnections
      ? <a href={connectionsHref}>View Connections</a>
      : "Ask an administrator to check Connections.";
    let notice;
    let action;
    const templateReady = configuration?.whatsapp_template_ready === true && Boolean(onTemplateSend)
      && current.reply_requires_approval === false;
    const chooseTemplateAction = <button type="button" className="inbox-text-button" disabled={busy}
      onClick={() => setShowTemplates(true)}>Choose approved template</button>;
    let chooseTemplate = false;
    if (!can("reply") || !can("send")) {
      notice = "You need reply and send permissions to message this customer.";
      action = "Ask an administrator for access.";
    } else if (c.opted_out) {
      notice = "This customer opted out. You can still add an internal note.";
    } else if (c.status === "resolved") {
      notice = "This conversation is resolved. Reopen it from the conversation status to reply.";
    } else if (sendInProgress) {
      notice = "A reply is awaiting its send result. Check the message in this conversation before sending again.";
    } else if (whatsAppStatusUnavailable) {
      notice = "Sending availability could not be checked.";
      action = "Refresh this conversation to try again.";
    } else if (configuration?.whatsapp_connection_ready === false) {
      notice = "This WhatsApp connection needs attention before you can send.";
      action = connectionAction;
    } else if (configuration?.whatsapp_staff_ready === undefined) {
      notice = "Checking WhatsApp sending availability…";
    } else if (!c.takeover) {
      notice = "Take over this conversation in the conversation header to reply.";
    } else if (!windowOpen) {
      notice = "The 24-hour reply window is closed.";
      if (current.reply_requires_approval !== false) {
        action = "Ask the conversation owner to review it before sending.";
      } else if (templateReady) {
        chooseTemplate = true;
        action = chooseTemplateAction;
      } else {
        notice += " Template sending is unavailable for this conversation.";
        action = connectionAction;
      }
    } else if (configuration.whatsapp_staff_ready !== true) {
      notice = templateReady
        ? "A text reply is unavailable for this conversation."
        : "WhatsApp sending is unavailable for this conversation.";
      chooseTemplate = templateReady;
      action = chooseTemplate ? chooseTemplateAction : connectionAction;
    } else if (requiresApproval) {
      notice = "This reply requires staff review. Ask the conversation owner to review it.";
    }
    const templateAvailable = chooseTemplate || (windowOpen && !notice && templateReady);
    const inputLabel = note ? "Internal note" : "Staff Reply";
    const aiHint = aiUnavailable || "Prepare a suggestion for staff review. Suggestions never send automatically.";
    return (
      <div className="inbox-composer" aria-label="Reply composer">
        <div className="inbox-composer-tools">
          {can("reply") && <button type="button" className={`inbox-text-button ${note ? "" : "active"}`} aria-pressed={!note} onClick={() => switchMode("reply")}>Staff Reply</button>}
          {can("manage") && <button type="button" className={`inbox-text-button ${note ? "active" : ""}`} aria-pressed={note} onClick={() => switchMode("note")}>Internal note</button>}
          <span className="inbox-tool-spacer" />
          {!note && can("ai") && !suggestion && <span title={aiHint}>
            <button type="button" className="btn-secondary" aria-label="AI Suggested Reply" aria-description={aiHint} disabled={busy || Boolean(aiUnavailable)} onClick={() => suggest()}><Sparkles size={14} />AI Suggested Reply</button>
          </span>}
          {!note && suggestion && <details className="inbox-suggestion">
            <summary>AI suggested reply</summary>
            <strong>{assistanceLabel(suggestion.body.classification)}</strong>
            <p className="whitespace-pre-wrap">{suggestion.body.text}</p>
            {suggestion.body.handoff_reasons?.length > 0 && <p>Staff review: {suggestion.body.handoff_reasons.map(reason => reason.replaceAll('_',' ')).join(' · ')}</p>}
            {suggestion.body.sources?.length > 0 && <ul>{suggestion.body.sources.map(source => <li key={source.key}>{aiSourceLabel(source)} · {source.label}</li>)}</ul>}
            <button type="button" className="inbox-text-button" disabled={busy} onClick={() => reviewAI(suggestion.id,false)}>Dismiss</button>
          </details>}
        </div>
        {!note && notice && <div className="inbox-assistance-status mb-2">
          <span role="status">{notice}</span>{action && <> {action}</>}
        </div>}
        <label className="sr-only" htmlFor={`inbox-compose-${c.id}`}>{inputLabel}</label>
        <textarea id={`inbox-compose-${c.id}`} className="control" rows={2} value={text}
          disabled={busy || (note ? !can("manage") : Boolean(notice))}
          maxLength={note ? 8000 : 2000}
          placeholder={note ? "Add a note for your team…" : "Write a WhatsApp reply…"}
          onChange={event => {setText(event.target.value);setDirty(true);}} />
        <div className="inbox-composer-footer"><div className="marketing-inbox-actions ml-auto">
          {!note && !notice && templateAvailable &&
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setShowTemplates(true)}>Use template</button>}
          {note
            ? <button type="button" className="btn-primary" disabled={busy || !can("manage") || !text.trim()} onClick={save}>Save note</button>
            : can("reply") && <button type="button" className="btn-primary" disabled={busy || Boolean(notice) || !directReady || !windowOpen}
              onClick={async () => {
                if (Date.parse(whatsAppDeadline) <= Date.now()) {setExpiredDeadline(whatsAppDeadline);return;}
                if (await onDirectSend(text, null)) {setText("");setDirty(false);}
              }}><Send size={14} />Send</button>}
        </div></div>
        {!note && templateAvailable && showTemplates && <Modal title="Choose approved template" onClose={() => setShowTemplates(false)}>
          <WhatsAppTemplateCatalog loadTemplates={() => inboxService.whatsappTemplateOptions(c.id)} onSend={async (template) => {
            if (busy) return false;
            const result = await onTemplateSend(template);
            if (result) setShowTemplates(false);
            return result;
          }} />
        </Modal>}
      </div>
    );
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
        <span className="inbox-tool-spacer" /><div className="inbox-reply-help" role="group" aria-label="Reply assistance">
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
            title={faqUnavailable||'Find a matching Active FAQ · no AI generation'}
            onClick={()=>faqPreview(faqQuestion)}
          >
            <BookOpen size={14} />
            FAQs
          </button>
        )}
      </div></div>
      {mode === "reply" && can("ai") && aiUnavailable && <p className="inbox-assistance-status" role="status">{aiUnavailable} {can('configure')&&setupHref?<a href={setupHref}>Open FAQ & AI settings</a>:null}</p>}
      {mode === "reply" && !suggestion && !handoffVisibleInHeader && handoff.length>0 && <div className="inbox-assistance-handoff" role="status"><strong>Needs Human Attention</strong><p>{handoff.map(reason=>reason.replaceAll('_',' ')).join(' · ')}. Use the existing assignment or handling controls; AI never assigns or sends.</p></div>}
      {mode === "reply" && suggestion && (
        <section className="inbox-suggestion inbox-ai-suggestion" aria-label="AI suggested reply">
          <div className="inbox-suggestion-content">
          <div className="inbox-assistance-heading"><strong>{assistanceLabel(suggestion.body.classification)}</strong><small>{suggestion.body.match_source==='deterministic'?(suggestion.body.matched_faq_ids?.length?'FAQ match · no AI tokens':'Staff handling · no AI tokens'):'Suggest only'}</small></div>
          <p>{suggestion.body.text}</p>
          {suggestion.body.handoff_reasons?.length>0 && <p className="inbox-assistance-status">Staff review: {suggestion.body.handoff_reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}</p>}
          {suggestion.body.unresolved_questions?.length>0 && <details><summary>Needs confirmation ({suggestion.body.unresolved_questions.length})</summary><ul>{suggestion.body.unresolved_questions.map((question,i)=><li key={i}>{question}</li>)}</ul></details>}
          {suggestion.body.matches?.some(match=>match.use_issue) && <details><summary>Related FAQs need confirmation</summary><ul>{suggestion.body.matches.filter(match=>match.use_issue).map(match=><li key={match.id}>{match.question} · {match.use_issue}</li>)}</ul></details>}
          {suggestion.body.sources?.length>0 && <details><summary>Sources ({suggestion.body.sources.length})</summary><ul>{suggestion.body.sources.map(source=><li key={source.key}>{aiSourceLabel(source)} · {source.label}</li>)}</ul></details>}
          </div>
          <div className="marketing-inbox-actions">
            {can("reply") && <button className="btn-secondary" disabled={busy} onClick={()=>{setText(suggestion.body.text);setDirty(true);setSourceArtifact(suggestion.id);}}>Use Reply</button>}
            {can('ai') && <button className="inbox-text-button" disabled={busy||Boolean(aiUnavailable)} onClick={()=>suggest(suggestion.id)}>Regenerate</button>}
            <button className="inbox-text-button" disabled={busy} onClick={()=>reviewAI(suggestion.id,false)}>Dismiss</button>
          </div>
          {can('ai')&&feedbackAI?<div className="inbox-ai-feedback" aria-label="Suggestion feedback"><span>Was this helpful?</span><button type="button" className="inbox-text-button" aria-pressed={feedback?.helpful===true} disabled={busy} onClick={()=>feedbackAI(suggestion.id,true,null)}><ThumbsUp size={14}/>Helpful</button><button type="button" className="inbox-text-button" aria-pressed={feedback?.helpful===false} disabled={busy} onClick={()=>feedbackAI(suggestion.id,false,null)}><ThumbsDown size={14}/>Not Helpful</button>{feedback?.helpful===false?<SelectField label="What could improve?" value={feedback.reason||''} disabled={busy} onChange={reason=>feedbackAI(suggestion.id,false,reason||null)} options={[{value:'',label:'Optional reason'},{value:'incorrect_facts',label:'Incorrect facts'},{value:'wrong_outlet',label:'Wrong Outlet'},{value:'missed_question',label:'Missed a question'},{value:'language_tone',label:'Language or tone'},{value:'missing_knowledge',label:'Missing knowledge'},{value:'not_relevant',label:'Not relevant'},{value:'other',label:'Other'}]}/>:null}{feedback?<small role="status">Feedback saved</small>:null}</div>:null}
          <small className="inbox-muted">Review and edit before sending. {suggestion.body.human_required?'Staff approval is required.':''}</small>
        </section>
      )}
      {mode === "reply" && preview && (!handoffVisibleInHeader||preview.faq) && (
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
