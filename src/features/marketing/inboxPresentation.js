// Presentation only: canonical records and server approval/send authorities remain unchanged.
export function socialIdentity(conversation) {
  if (conversation.channel === "internal")
    return { name: conversation.title || "Internal case", known: true };
  // Never use the connection's account name or brand-derived conversation title as a customer.
  const profile = conversation.customer_profile;
  const handle = profile?.handle;
  return {
    name:
      profile?.display_name ||
      (handle
        ? `@${handle.replace(/^@/, "")}`
        : `${conversation.channel === "whatsapp" ? "WhatsApp" : conversation.channel === "instagram" ? "Instagram" : "Facebook"} customer`),
    handle,
    avatar: profile?.avatar_url,
    known: Boolean(profile?.display_name || handle),
    unavailableReason: profile?.diagnostic?.status === 'denied' ? 'Meta has not made this customer profile available.' : 'Customer profile unavailable',
  };
}
export function conversationTimeline(detail) {
  const outbox = detail.outbox || [];
  const messages = (detail.messages || []).filter((m) =>
    ["incoming", "echo", "attachment", "note"].includes(m.kind),
  );
  // A genuine accepted receipt is outbound evidence even before its echo arrives.
  const accepted = (detail.drafts || []).flatMap((d) => {
    const o = outbox.find((o) => o.draft_id === d.id);
    if (
      detail.timeline_projected ||
      !o?.provider_message_id ||
      !["sent", "delivered", "read"].includes(o.state) ||
      !o.sent_at ||
      messages.some(
        (m) =>
          m.kind === "echo" && m.provider_message_id === o.provider_message_id,
      )
    )
      return [];
    return [
      {
        id: `sent-${d.id}`,
        kind: "echo",
        body: d.body,
        provider_message_id: o.provider_message_id,
        occurred_at: o.sent_at,
        send_state: o.state,
      },
    ];
  });
  return [...messages, ...accepted]
    .map((m) => {
      const receipt =
        m.kind === "echo"
          ? outbox.find(
              (o) =>
                o.provider_message_id &&
                o.provider_message_id === m.provider_message_id,
            )
          : null;
      return { ...m, send_state: receipt?.state || m.send_state };
    })
    .sort(
      (a, b) =>
        new Date(a.occurred_at) - new Date(b.occurred_at) ||
        (detail.conversation?.channel === "whatsapp" && Number.isSafeInteger(a.sequence) && Number.isSafeInteger(b.sequence) ? a.sequence - b.sequence : 0) ||
        String(a.id).localeCompare(String(b.id)),
    );
}
export function replyAvailability(current, configuration, canSend) {
  const c = current.conversation;
  if (c.channel === "internal") return "Internal case · no customer recipient";
  if (c.channel === "whatsapp") return "WhatsApp sending is disabled";
  if (c.opted_out) return "Customer opted out · replies are paused";
  if (c.status === "resolved") return "Reopen this conversation to reply";
  if (c.medium && c.medium !== "dm") return "Comment replies are unavailable";
  if (!canSend) return "Sending requires staff permission";
  if (!configuration?.staff_send_configured)
    return "Sending is disabled · ask an administrator";
  if (configuration?.recipient_allowed === false) return "Recipient is outside the approved test scope";
  if (!current.window_open) return "Reply window closed or unavailable";
  if (!current.channel_capability?.receiving_verified)
    return "Messaging connection needs verification";
  if (current.reply_authority?.verified === false) return "Reconnect or refresh this messaging connection";
  if (current.reply_authority?.recent === false) return "Refresh connection status before sending";
  if((current.ai_handling?.mode||current.policy?.ai_reply_mode||'suggest_only')!=='suggest_only'&&!c.takeover)return "Take over this conversation before sending a staff reply";
  return "";
}

export function replyOutcomeMessage(result) {
 if(['sent','delivered','read'].includes(result?.state))return result.state==='sent'?'Meta accepted the reply. Delivery has not yet been confirmed.':result.state==='delivered'?'Delivery observed by Meta.':'Read observed by Meta.';
 if(result?.state==='prepared')return 'Reply queued. Meta acceptance has not been recorded.';
 if(result?.state==='pending')return 'Reply is being sent. Wait for its result before taking another action.';
 if(result?.state==='reconciling')return 'Send outcome is unknown. Check reply status; do not resend while it is being reconciled.';
 const reasons={provider_token_invalid:'The connection credential is invalid or expired. Reconnect before trying again.',provider_permission_required:'Meta rejected the reply authority. Check account permissions and the reply window before trying again.',provider_rate_limited:'Meta rate-limited this reply. Wait, refresh connection status, then retry manually.',provider_recipient_unavailable:'Meta could not message this customer. Check recipient availability before trying again.'};
 return reasons[result?.code]||'Meta rejected the reply. Check connection status and reply details before retrying manually.';
}
export function replyWasAccepted(result){return ['sent','delivered','read'].includes(result?.state);}

export const replyStateLabel = state => ({blocked:'Not sent',prepared:'Queued',pending:'Sending',sent:'Provider accepted',delivered:'Delivered',read:'Read',failed:'Failed',reconciling:'Unknown · reconciling'})[state] || 'Unavailable';

export function replySourceLabel(reference) {
  if (typeof reference === 'string') return reference.replaceAll('_', ' ');
  if (reference?.artifact_id) return 'AI suggestion';
  if (reference?.faq_id) return `Active FAQ · revision ${reference.faq_revision ?? 'unavailable'}`;
  return 'Source evidence';
}

export function automaticReplyReason(reason) {
 return ({safe_translation_unavailable:'A verified reply in the customer’s language is unavailable. Staff should reply.',safety_or_human_request:'This enquiry needs a team member.',insufficient_knowledge:'Current knowledge cannot safely answer this enquiry.',outside_automatic_scope:'This conversation is outside the enabled AI scope.',generation_quota_or_authority:'AI is paused. Check usage limits and Brand access.',automatic_processing_failed:'AI could not finish safely. Staff should review the conversation.',delivery_uncertain:'Delivery is uncertain. Check the existing send result before taking further action.',provider_rejected:'The messaging provider rejected this reply.',decision_changed:'The conversation or supporting information changed.',clarification_loop:'The customer still needs help after clarification.',conversation_response_limit:'The automatic response limit was reached.',human_or_conversation_changed:'Staff handling or conversation eligibility changed.'})[reason]||String(reason||'').replaceAll('_',' ');
}
