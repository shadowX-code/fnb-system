import { supabase } from "../../lib/supabase";
import { throwSupabaseError } from "../../services/supabaseError.js";
async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(`marketing.${name}`, error);
  return data;
}
async function invoke(path, options = {}) {
  const { data, error } = await supabase.functions.invoke(
    `marketing-inbox/${path}`,
    options,
  );
  if (error) {
    let message = "Inbox service is unavailable.";
    if (error.context instanceof Response) {
      try {
        message = (await error.context.json()).error || message;
      } catch {}
    }
    throw new Error(message);
  }
  return data;
}
export const inboxService = {
  read: (
    {
      org,
      brand,
      status = "",
      channel = "",
      search = "",
      page = 1,
      pageSize = 20,
    },
  ) =>
    rpc("marketing_inbox_read", {
      p_org: org,
      p_brand: brand || null,
      p_status: status,
      p_channel: channel,
      p_search: search,
      p_page: page,
      p_size: pageSize,
    }),
  detail: (id, page = 1) =>
    rpc("marketing_inbox_detail", {
      p_conversation: id,
      p_page: page,
      p_size: 30,
    }),
  command: (request, org, brand, conversation, command, payload = {}) =>
    rpc("marketing_inbox_command", {
      p_request: request,
      p_org: org,
      p_brand: brand,
      p_conversation: conversation?.id || null,
      p_version: conversation?.version || 0,
      p_command: command,
      p_payload: payload,
    }),
  configure: (request, brand, revision, command, payload = {}) =>
    rpc("marketing_inbox_configure", {
      p_request: request,
      p_brand: brand,
      p_revision: revision,
      p_command: command,
      p_payload: payload,
    }),
  preview: (id, text) =>
    rpc("marketing_inbox_faq_preview", { p_conversation: id, p_text: text }),
  configuration: () => invoke("configuration", { method: "GET" }),
  suggest: (requestId, conversation, kind) =>
    invoke("suggest", {
      body: {
        requestId,
        conversationId: conversation.id,
        version: conversation.version,
        kind,
      },
    }),
  reviewAI: (id, approve) =>
    rpc("marketing_inbox_review_ai", { p_artifact: id, p_approve: approve }),
};
