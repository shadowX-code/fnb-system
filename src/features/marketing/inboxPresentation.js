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
        : `${conversation.channel === "instagram" ? "Instagram" : "Facebook"} customer`),
    handle,
    avatar: profile?.avatar_url,
    known: Boolean(profile?.display_name || handle),
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
        String(a.id).localeCompare(String(b.id)),
    );
}
export function replyAvailability(current, configuration, canSend) {
  const c = current.conversation;
  if (c.channel === "internal") return "Internal case · no customer recipient";
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
  return "";
}
