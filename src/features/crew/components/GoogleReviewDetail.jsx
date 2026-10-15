import { useEffect, useRef, useState } from 'react';
import Modal from '../../../components/feedback/Modal.jsx';
import GoogleReviewerAvatar from './GoogleReviewerAvatar.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import AdminFormField from '../../../components/forms/AdminFormField.jsx';
import { GoogleReviewStars } from './GoogleRatingOverview.jsx';
import { readReconciledReply } from '../services/googleReplyReconciliation.js';
import { googleBusinessService as service } from '../services/googleBusinessService.js';

const time = value => value ? new Date(value).toLocaleString('en-MY', {timeZone:'Asia/Kuala_Lumpur'}) : '—';
export function ownerReplyLabel(reply) {
  return !reply ? 'Not Replied' : reply.reviewReplyState==='PENDING' ? 'Replied · Pending Google review' : reply.reviewReplyState==='REJECTED' ? 'Reply rejected by Google' : 'Replied';
}
export const ownerReplyTone = reply => reply?.reviewReplyState==='REJECTED' ? 'danger' : reply?.reviewReplyState==='PENDING' ? 'warning' : reply ? 'success' : 'neutral';
const outcomes = {
  reply_busy:'This reply is being processed. Check status shortly.',
  reply_outcome_uncertain:'Google’s reply outcome is uncertain. Check status before retrying the same reply.',
  reply_audit_unconfirmed:'The reply outcome could not be recorded. Check status before retrying.',
  reply_not_confirmed:'The reply is not yet confirmed on Google. Check again or retry the same reply.',
  reply_authority_changed:'Reply permission, mapping or lease changed. Check status and reload this review before retrying.',
  reply_changed:'The owner reply changed on Google. Reload the reply and review your draft before publishing.',
  reply_intent_expired:'This reply intent expired. Reload the current reply before preparing a new submission.',
  reply_readback_pending:'Google’s read-back has not caught up with the confirmed reply. Reload before submitting another reply.',
  reconnect_required:'Reconnect Google Business Profile in Settings, then reload this review.',
  google_access_denied:'Google denied reply access for this location. Check the connected account’s authorization.',
  reply_rejected:'Google rejected the reply request. Review your text and try again.',
  google_unavailable:'Google could not be reached. Your draft is preserved.',
};
export default function GoogleReviewDetail({ review: initialReview, outletId, basis, outletName, onClose, onConfirmed }) {
  const [data,setData]=useState(null), [review,setReview]=useState(initialReview), [draft,setDraft]=useState(initialReview.reviewReply?.comment || '');
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [confirm,setConfirm]=useState(false);
  const [syncPending,setSyncPending]=useState(false);
  const [error,setError]=useState(''), [feedback,setFeedback]=useState(''), [outcome,setOutcome]=useState(null);
  const pending=useRef(false), request=useRef(null), live=useRef(true), sequence=useRef(0);
  const bytes=new TextEncoder().encode(draft).length;
  const unsettled=['uncertain','sending'].includes(outcome?.status);
  const action=review.reviewReply ? 'Update Reply' : 'Publish Reply';
  useEffect(()=>{live.current=true; load(false);return()=>{live.current=false;++sequence.current;};},[]);
  useEffect(()=>{
    if(!data?.read_expires_at)return undefined;
    const timer=setTimeout(()=>{setReview({name:initialReview.name});setData(null);setError('Review content expired. Reload the current reply; your draft is preserved.');},Math.max(0,Date.parse(data.read_expires_at)-Date.now()));
    return()=>clearTimeout(timer);
  },[data?.read_expires_at]);
  const successText=reply=>reply?.reviewReplyState==='PENDING' ? 'Reply submitted. Pending Google review.' : reply?.reviewReplyState==='REJECTED' ? 'Google rejected the submitted reply. Review the reply status.' : 'Reply synced.';
  function applyDetail(next,preserveDraft,showSuccess=false) {
    setData(next);setReview(next.review);if(!preserveDraft)setDraft(next.review.reviewReply?.comment || '');
    setSyncPending(Boolean(next.reply_sync_pending));
    setFeedback(next.reply_sync_pending ? 'Sync pending' : showSuccess ? successText(next.review.reviewReply) : '');
  }
  async function load(preserveDraft=true) {
    if(pending.current)return;
    const id=++sequence.current;setLoading(true);setError('');setFeedback('Syncing reply…');
    try {
      const next=await readReconciledReply(()=>service.detail(outletId,initialReview.name,basis),()=>live.current && id===sequence.current);
      if(!next || !live.current || id!==sequence.current)return;
      applyDetail(next,preserveDraft,outcome?.status==='confirmed' || syncPending);
      if(!unsettled){request.current=null;setOutcome(null);}
    } catch(cause){if(live.current && id===sequence.current){setData(null);setFeedback(outcome?.status==='confirmed' || syncPending ? 'Sync pending' : '');setSyncPending(outcome?.status==='confirmed' || syncPending);setError(cause.message || 'Unable to load the current Google reply.');}}
    finally{if(live.current && id===sequence.current)setLoading(false);}
  }
  async function submit(checkId) {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');setFeedback(checkId ? 'Checking Google reply status…' : 'Submitting reply…');setConfirm(false);
    const matchesCurrent=!checkId || checkId===request.current;
    try {
      if(!checkId && !request.current)request.current=crypto.randomUUID();
      const id=checkId || request.current;
      const result=checkId ? await service.replyStatus(outletId,id) : await service.reply(outletId,{id,review:review.name,comment:draft,expectedHash:data.expectedHash,existingReply:Boolean(review.reviewReply),generation:data.generation,revision:data.revision});
      if(!live.current)return;
      setOutcome(result);
      if(result.status==='confirmed') {
        setFeedback('Syncing reply…');setSyncPending(true);setLoading(true);setBusy(false);
        request.current=null;
        if(result.remoteReply){setReview(current=>({...current,reviewReply:result.remoteReply}));if(matchesCurrent)setDraft(result.remoteReply.comment);setData(current=>({...current,expectedHash:result.expectedHash}));}
        try{await onConfirmed();}catch{if(live.current)setError('The Inbox could not refresh; reload reviews to see the latest state.');}
        if(live.current)try{const next=await readReconciledReply(()=>service.detail(outletId,review.name,basis),()=>live.current);if(next && live.current)applyDetail(next,!matchesCurrent,true);}catch(cause){if(live.current){setData(null);setFeedback('Sync pending');setError(cause.message || 'Unable to read the current Google reply.');}}finally{if(live.current)setLoading(false);}
      } else {
        setFeedback('');setError(result.code==='google_rate_limited' ? `Google rate limit (429): ${result.service || 'mybusiness.googleapis.com'} · ${result.request || 'Review reply request'}. Check this request before retrying.` : outcomes[result.code] || 'Reply could not be confirmed. Your draft is preserved.');
      }
    } catch(cause) {
      if(live.current){setFeedback('');setError(cause.message || 'Reply request failed. Your draft is preserved.');setOutcome({status:cause.uncertain!==false ? 'uncertain' : 'rejected'});}
    } finally{pending.current=false;if(live.current)setBusy(false);}
  }
  const canWrite=review.reviewReply ? (data?.can_edit_reply ?? data?.can_reply) : (data?.can_publish_reply ?? data?.can_reply);
  const canPublish=canWrite && data.expectedHash && !loading && !busy && !syncPending && draft.trim() && bytes<=4096 && (unsettled || draft!==(review.reviewReply?.comment || '')) && outcome?.status!=='conflict';
  return <>
    <Modal title="Review Detail" description={outletName} size="md" onClose={()=>{if(!busy)onClose();}} footerClassName="flex-col" footer={<><div className="space-y-2">        {feedback ? <div role="status" className="text-sm text-text-secondary"><p>{feedback}</p>{syncPending && !loading && !error ? <button className="btn-secondary mt-2" onClick={()=>load(true)}>Retry sync</button> : null}</div> : null}
        {error ? <div role="alert" className="rounded-lg border border-rose-200 p-3 text-sm text-rose-700"><p>{error}</p><div className="mt-2 flex flex-wrap gap-2">{request.current && unsettled ? <button className="btn-secondary" disabled={busy} onClick={()=>submit(request.current)}>Check Status</button> : <button className="btn-secondary" disabled={busy || loading} onClick={()=>load(true)}>{syncPending ? 'Retry sync' : 'Reload reply'}</button>}</div></div> : null}
</div><div className="flex justify-end gap-2">
      <button className="btn-secondary" disabled={busy} onClick={()=>{if(!busy)onClose();}}>Close</button>
      {canWrite ? <button className="btn-primary" disabled={!canPublish} onClick={()=>setConfirm(true)}>{busy ? 'Working…' : action}</button> : null}
    </div></>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><GoogleReviewerAvatar reviewer={review.reviewer} /><div className="min-w-0"><strong className="text-sm">{review.reviewer?.displayName || 'Google reviewer'}</strong><span className="ml-3 inline-flex"><GoogleReviewStars rating={review.starRating} /></span></div></div><time className="text-sm text-text-secondary" dateTime={review.createTime}>{time(review.createTime)}</time></div>
        <p className="whitespace-pre-wrap break-words text-sm">{review.comment || 'No written review'}</p>
        <section className="space-y-2 rounded-lg bg-surface-muted p-3" aria-label="Existing owner reply">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Owner reply</h3><Badge tone={ownerReplyTone(review.reviewReply)}>{data || review.reviewReply ? ownerReplyLabel(review.reviewReply) : loading ? 'Checking reply…' : 'Reply unavailable'}</Badge></div>
          {review.reviewReply ? <><p className="whitespace-pre-wrap break-words text-sm">{review.reviewReply.comment}</p><time className="text-sm text-text-secondary" dateTime={review.reviewReply.updateTime}>{time(review.reviewReply.updateTime)}</time></> : null}
        </section>
        {loading ? feedback ? null : <p role="status" className="text-sm">Loading current Google reply…</p> : (canWrite || draft && draft!==(review.reviewReply?.comment || '')) ? <AdminFormField label="Your reply"><textarea aria-label="Your reply" className="control min-h-32 w-full" value={draft} disabled={!canWrite || busy || unsettled} onChange={event=>{setDraft(event.target.value);request.current=null;setOutcome(null);if(!syncPending)setFeedback('');}} /><span className="text-sm text-text-secondary">{bytes} / 4096 bytes</span></AdminFormField> : data ? <p className="text-sm text-text-secondary">Your access allows viewing only.</p> : null}
        {data?.history?.length ? <section className="space-y-2 border-t border-border pt-3"><h3 className="text-sm font-semibold">Reply History</h3><ol className="divide-y divide-border">{data.history.map(item=><li key={item.request_id} className="space-y-1 py-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{item.operation==='update' ? 'Update Reply' : 'Publish Reply'} · {{ready:'Prepared',sending:'Pending',uncertain:'Outcome uncertain',confirmed:'Confirmed',rejected:'Not accepted',conflict:'Review required'}[item.status] || 'Pending'}</span><time dateTime={item.updated_at}>{time(item.updated_at)}</time></div><p className="text-text-secondary">{item.actor}</p>{canWrite && ['uncertain','sending'].includes(item.status) ? <button className="btn-secondary" disabled={busy} onClick={()=>submit(item.request_id)}>Check Status</button> : null}</li>)}</ol></section> : null}
      </div>
    </Modal>
    {confirm ? <Modal title={action} description={`This reply will be sent to Google for ${outletName}.`} onClose={()=>{if(!busy)setConfirm(false);}} footer={<><button className="btn-secondary" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button className="btn-primary" disabled={!canPublish} onClick={()=>submit()}>{action}</button></>}><p className="whitespace-pre-wrap break-words text-sm">{draft}</p></Modal> : null}
  </>;
}
