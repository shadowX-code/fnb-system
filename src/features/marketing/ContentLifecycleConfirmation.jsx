import {CONTENT_TIMEZONE,contentStatusLabel,contentTimestamp} from './contentManagement.js';

export default function ContentLifecycleConfirmation({content,restoring,discardingEdits=false,accepted,onChange}) {
 const draft=content.status==='draft'&&!restoring;
 const allowed=content.lifecycle?.[restoring?'can_restore':'can_delete']===true;
 const channels=content.channels?.length?content.channels:content.payload?.variants||[];
 return <section className="space-y-4" aria-label={restoring?'Restore post summary':'Delete post summary'}>
  <p className="text-sm text-text-secondary">{restoring?'Restore the same captions and media as a new draft revision. Previous jobs stay cancelled. Review the draft and confirm publishing again; restoring never sends.':draft?'Delete this draft and all its channel variants from Calendar and List. Media, revisions and history are retained.':'Stop pending delivery and hide this post from Calendar and List. Media and history are retained. This does not delete any published post on Meta.'}</p>
  {discardingEdits?<p className="text-sm text-text-secondary">Deleting this draft discards any unsaved edits. Go back to keep editing.</p>:null}
  <div><strong>{content.title||content.payload?.title}</strong><p className="text-sm text-text-secondary">{content.brand_name}</p></div>
  <ul className="divide-y divide-border rounded-xl border border-border">{channels.map(channel=><li key={channel.channel} className="px-3 py-2 text-sm"><strong>{contentStatusLabel(channel.channel)} · {contentStatusLabel(channel.format)}</strong><span className="block text-text-secondary">{draft?'Draft · no active publishing schedule':`${contentTimestamp(channel.scheduled_at||content.scheduled_at||content.payload?.planned_at,'No publishing time set')} · ${CONTENT_TIMEZONE}`}</span></li>)}</ul>
  {allowed?<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={e=>onChange(e.target.checked)}/>{restoring?'Restore as draft; publishing will require a new confirmation.':draft?'Delete this draft and all listed channel variants.':'Delete this unpublished post and stop the listed scheduled deliveries.'}</label>:<p role="alert">{content.lifecycle?.reason||'This action is no longer available. Close and reopen the post.'}</p>}
 </section>;
}
