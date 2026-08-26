import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";
import {
  IMAGE_UPLOAD_MAX_BYTES,
  optimizeImageBlob,
  validateLearningImageFile,
} from "../utils/imageUpload.js";

export const CREW_ACCESS_STATE_LABEL = {
  active: "Active",
  disabled: "Disabled",
  locked: "Locked",
  not_enabled: "Not Enabled",
};

export function crewAccessState(access) {
  return access?.access_state || "not_enabled";
}

const relationRows = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const localBusinessDate = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function normalizeAdminJourney(journey) {
  return {
    ...journey,
    modules: relationRows(journey.modules).map((module) => ({
      ...module,
      lessons: relationRows(module.lessons).map((lesson) => ({
        ...lesson,
        blocks: relationRows(lesson.blocks),
        quizzes: relationRows(lesson.quizzes).map((quiz) => ({
          ...quiz,
          questions: relationRows(quiz.questions).map((question) => ({
            ...question,
            options: relationRows(question.options),
          })),
        })),
      })),
    })),
  };
}

const isTemporaryCrewId = (id) => !id || String(id).startsWith("temp:");
const persistentCrewIds = (rows = []) => rows.map((row) => row.id).filter((id) => !isTemporaryCrewId(id));
const learningMediaIds = (journey) => new Set(
  (journey?.modules || [])
    .flatMap((module) => module.lessons || [])
    .flatMap((lesson) => lesson.blocks || [])
    .map((block) => block.payload?.media?.id)
    .filter(Boolean),
);

function durableLearningMedia(media) {
  if (!media?.id) return null;
  return {
    id: media.id,
    mime_type: media.mime_type || "image/webp",
    width: media.width || null,
    height: media.height || null,
    caption: String(media.caption || "").trim() || null,
    alt_text: String(media.alt_text || "").trim() || null,
  };
}

function durableSopMedia(media, caption = "") {
  if (!media?.id) return null;
  return {
    id: media.id,
    mime_type: media.mime_type || "image/webp",
    width: media.width || null,
    height: media.height || null,
    caption: String(caption ?? media.caption ?? "").trim() || null,
  };
}

async function prepareCrewDraftOrder(table, rows) {
  for (const [index, row] of rows.filter((item) => !isTemporaryCrewId(item.id)).entries()) {
    const { error } = await supabase.from(table).update({ sort_order: -1000000 - index }).eq("id", row.id);
    throwSupabaseError(`crew.saveOnboardingDraft.prepare.${table}`, error);
  }
}

async function deleteRemovedCrewDraftRows(table, originalRows = [], nextRows = []) {
  const retained = new Set(persistentCrewIds(nextRows));
  const removed = persistentCrewIds(originalRows).filter((id) => !retained.has(id));
  if (!removed.length) return;
  const { error } = await supabase.from(table).delete().in("id", removed);
  throwSupabaseError(`crew.saveOnboardingDraft.delete.${table}`, error);
}

async function saveCrewDraftRow(table, row, payload) {
  const query = isTemporaryCrewId(row.id)
    ? supabase.from(table).insert(payload)
    : supabase.from(table).update(payload).eq("id", row.id);
  const { data, error } = await query.select().single();
  throwSupabaseError(`crew.saveOnboardingDraft.save.${table}`, error);
  return data;
}

export const crewService = {
  async learningHome(token) {
    const { data, error } = await supabase.rpc("crew_learning_home", { p_token: token });
    throwSupabaseError("crew.learningHome", error);
    return data || { assignment: null, required_sops: [] };
  },

  async growthMobile(token) {
    const { data, error } = await supabase.rpc("crew_growth_mobile", { p_token: token });
    throwSupabaseError("crew.growthMobile", error);
    return data || {
      summary: { certified: 0, in_progress: 0, ready_for_review: 0, not_started: 0, total: 0 },
      skills: [],
      timeline: [],
      performance: null,
    };
  },

  async performanceMobile(token, period = new Date().toISOString().slice(0, 10)) {
    const { data, error } = await supabase.rpc("crew_performance_mobile", { p_token: token, p_period: period });
    throwSupabaseError("crew.performanceMobile", error);
    return data;
  },

  async rewardMobile(token, period = new Date().toISOString().slice(0, 10)) {
    const { data, error } = await supabase.rpc("crew_reward_mobile", { p_token: token, p_period: period });
    throwSupabaseError("crew.rewardMobile", error);
    return data;
  },

  async operationsToday(token, date = localBusinessDate()) {
    const { data, error } = await supabase.rpc("crew_tasks_today", { p_token: token, p_business_date: date });
    throwSupabaseError("crew.operationsToday", error);
    return data || { tasks: [], attendance_context: null };
  },

  async operationsAllTasks(token, from = null, to = null) {
    const { data, error } = await supabase.rpc("crew_tasks_for_crew", {
      p_token: token,
      p_from: from || null,
      p_to: to || null,
    });
    throwSupabaseError("crew.operationsAllTasks", error);
    return data || { tasks: [], attendance_context: null };
  },

  async myRoster(token, from = localBusinessDate(), to = null) {
    const end = to || (() => {
      const value = new Date(`${from}T00:00:00`);
      value.setDate(value.getDate() + 13);
      return localBusinessDate(value);
    })();
    const { data, error } = await supabase.rpc("crew_my_roster", { p_token: token, p_from: from, p_to: end });
    throwSupabaseError("crew.myRoster", error);
    return data || { from, to: end, today: null, entries: [] };
  },

  async myLeave(token) {
    const { data, error } = await supabase.rpc("crew_leave_mobile", { p_token: token });
    throwSupabaseError("crew.myLeave", error);
    return data || { requests: [], upcoming: [] };
  },

  async submitLeave(token, payload) {
    const { data, error } = await supabase.rpc("crew_leave_submit", { p_token: token, p_payload: payload });
    throwSupabaseError("crew.submitLeave", error);
    return data;
  },

  async cancelLeave(token, requestId) {
    const { data, error } = await supabase.rpc("crew_leave_cancel", { p_token: token, p_request_id: requestId });
    throwSupabaseError("crew.cancelLeave", error);
    return data;
  },

  async leaveAdminData(outletId, from = null, to = null) {
    const { data, error } = await supabase.rpc("crew_leave_admin_data", { p_outlet_id: outletId, p_from: from || null, p_to: to || null });
    throwSupabaseError("crew.leaveAdminData", error);
    return data || { requests: [] };
  },

  async reviewLeave(requestId, decision, rejectionReason = null) {
    const { data, error } = await supabase.rpc("crew_leave_review", { p_request_id: requestId, p_decision: decision, p_rejection_reason: rejectionReason || null });
    throwSupabaseError("crew.reviewLeave", error);
    return data;
  },

  async saveLeavePolicy(outletId, leaveType, payload) {
    const { data, error } = await supabase.rpc("crew_leave_policy_save", { p_outlet_id: outletId, p_leave_type: leaveType, p_payload: payload });
    throwSupabaseError("crew.saveLeavePolicy", error);
    return data;
  },

  async adjustLeaveBalance(entitlementId, amount, reason) {
    const { data, error } = await supabase.rpc("crew_leave_adjust", { p_entitlement_id: entitlementId, p_amount: amount, p_reason: reason });
    throwSupabaseError("crew.adjustLeaveBalance", error);
    return data;
  },

  async leaveAdjustmentHistory(employeeId) {
    const { data, error } = await supabase.rpc("crew_leave_adjustment_history", { p_employee_id: employeeId });
    throwSupabaseError("crew.leaveAdjustmentHistory", error);
    return data || [];
  },

  async operationDetail(token, instanceId) {
    const { data, error } = await supabase.rpc("crew_tasks_detail", { p_token: token, p_instance_id: instanceId });
    throwSupabaseError("crew.operationDetail", error);
    return data;
  },

  async updateOperationItem(token, itemId, action, reason = null, note = null) {
    const { data, error } = await supabase.rpc("crew_tasks_update_block", { p_token: token, p_block_id: itemId, p_action: action, p_response: {}, p_reason: reason, p_note: note });
    throwSupabaseError("crew.updateOperationItem", error);
    return data;
  },

  async updateTaskBlock(token, blockId, action, response = {}, reason = null, note = null) {
    const { data, error } = await supabase.rpc("crew_tasks_update_block", { p_token: token, p_block_id: blockId, p_action: action, p_response: response, p_reason: reason, p_note: note });
    throwSupabaseError("crew.updateTaskBlock", error);
    return data;
  },

  async completeOperationChecklist(token, instanceId) {
    const { data, error } = await supabase.rpc("crew_tasks_complete", { p_token: token, p_instance_id: instanceId });
    throwSupabaseError("crew.completeOperationChecklist", error);
    return data;
  },

  async updateDailyTask(token, taskId, action, reason = null, note = null) {
    const { data, error } = await supabase.rpc("crew_operations_update_daily_task", { p_token: token, p_task_id: taskId, p_action: action, p_reason: reason, p_note: note });
    throwSupabaseError("crew.updateDailyTask", error);
    return data;
  },

  async operationsAdminData(outletId, date = new Date().toISOString().slice(0, 10)) {
    const { data, error } = await supabase.rpc("crew_operations_admin_data", { p_outlet_id: outletId, p_business_date: date });
    throwSupabaseError("crew.operationsAdminData", error);
    return data || { summary: {}, templates: [], instances: [], daily_tasks: [], activity: [], published_sops: [] };
  },

  async tasksAdminData(outletId, from = localBusinessDate(), to = from) {
    const { data, error } = await supabase.rpc("crew_tasks_admin_data", { p_outlet_id: outletId, p_from: from, p_to: to });
    throwSupabaseError("crew.tasksAdminData", error);
    return data || { definitions: [], instances: [], published_sops: [], employees: [] };
  },

  async cashCheckoutMobile(token, date = localBusinessDate()) {
    const { data, error } = await supabase.rpc("crew_cash_mobile", { p_token: token, p_business_date: date });
    throwSupabaseError("crew.cashCheckoutMobile", error);
    return data || { checkout: null, deposit: { current_balance: 0, recent: [] }, pending_receipts: [], receivers: [] };
  },

  async saveCashCheckout(token, action, payload = {}) {
    const { data, error } = await supabase.rpc("crew_cash_save_checkout", { p_token: token, p_action: action, p_payload: payload });
    throwSupabaseError("crew.saveCashCheckout", error);
    return data;
  },

  async recordCashCollection(token, payload) {
    const { data, error } = await supabase.rpc("crew_cash_record_collection", { p_token: token, p_payload: payload });
    throwSupabaseError("crew.recordCashCollection", error);
    return data;
  },

  async confirmCashCollection(token, collectionId, receivedAmount) {
    const { data, error } = await supabase.rpc("crew_cash_confirm_collection", { p_token: token, p_collection_id: collectionId, p_received_amount: receivedAmount });
    throwSupabaseError("crew.confirmCashCollection", error);
    return data;
  },

  async cashCheckoutAdminData(outletId, from = localBusinessDate(), to = from) {
    const { data, error } = await supabase.rpc("crew_cash_admin_data", { p_outlet_id: outletId, p_from: from, p_to: to });
    throwSupabaseError("crew.cashCheckoutAdminData", error);
    return data || { settings: {}, summary: {}, checkouts: [], ledger: [], collections: [], float_history: [], employees: [] };
  },

  async saveCashSettings(outletId, payload) {
    const { data, error } = await supabase.rpc("crew_cash_save_settings", { p_outlet_id: outletId, p_payload: payload });
    throwSupabaseError("crew.saveCashSettings", error);
    return data;
  },

  async reviewCashCheckout(checkoutId, decision, note = null) {
    const { data, error } = await supabase.rpc("crew_cash_review_checkout", { p_checkout_id: checkoutId, p_decision: decision, p_note: note });
    throwSupabaseError("crew.reviewCashCheckout", error);
    return data;
  },

  async recordAdminCashCollection(outletId, payload) {
    const { data, error } = await supabase.rpc("crew_cash_admin_record_collection", { p_outlet_id: outletId, p_payload: payload });
    throwSupabaseError("crew.recordAdminCashCollection", error);
    return data;
  },

  async saveCashHandoverReceivers(outletId, employeeIds, expectedVersion) {
    const { data, error } = await supabase.rpc("crew_cash_save_handover_receivers", { p_outlet_id: outletId, p_employee_ids: employeeIds, p_expected_version: expectedVersion });
    throwSupabaseError("crew.saveCashHandoverReceivers", error);
    return data;
  },

  async reviewCashCollection(collectionId, decision, note) {
    const { data, error } = await supabase.rpc("crew_cash_review_collection", { p_collection_id: collectionId, p_decision: decision, p_note: note });
    throwSupabaseError("crew.reviewCashCollection", error);
    return data;
  },

  async adjustCashCheckout(checkoutId, action, amount, reason) {
    const { data, error } = await supabase.rpc("crew_cash_adjust_checkout", { p_checkout_id: checkoutId, p_action: action, p_amount: amount, p_reason: reason });
    throwSupabaseError("crew.adjustCashCheckout", error);
    return data;
  },

  async saveTask(outletId, task) {
    const { data, error } = await supabase.rpc("crew_tasks_save", { p_outlet_id: outletId, p_task: task });
    throwSupabaseError("crew.saveTask", error);
    return data;
  },

  async ensureTaskDraft(templateId) {
    const { data, error } = await supabase.rpc("crew_tasks_ensure_draft", { p_template_id: templateId });
    throwSupabaseError("crew.ensureTaskDraft", error);
    if (data?.id && data.id !== templateId) await this.cloneLocalizedContent("task", templateId, data.id);
    return data;
  },

  async duplicateTask(templateId) {
    const { data, error } = await supabase.rpc("crew_tasks_duplicate", { p_template_id: templateId });
    throwSupabaseError("crew.duplicateTask", error);
    return data;
  },

  async manageTaskSchedule(templateId, action, endDate = null) {
    const { data, error } = await supabase.rpc("crew_tasks_manage_schedule", { p_template_id: templateId, p_action: action, p_end_date: endDate || null });
    throwSupabaseError("crew.manageTaskSchedule", error);
    return data;
  },

  async taskAdminDetail(templateId) {
    const { data, error } = await supabase.rpc("crew_tasks_admin_detail", { p_template_id: templateId });
    throwSupabaseError("crew.taskAdminDetail", error);
    return data;
  },

  async taskAdminResult(instanceId) {
    const { data, error } = await supabase.rpc("crew_tasks_admin_result", { p_instance_id: instanceId });
    throwSupabaseError("crew.taskAdminResult", error);
    return data;
  },

  async reviewTask(instanceId, employeeId, decision, note = null) {
    const { data, error } = await supabase.rpc("crew_tasks_review", { p_instance_id: instanceId, p_employee_id: employeeId, p_decision: decision, p_note: note });
    throwSupabaseError("crew.reviewTask", error);
    return data;
  },

  async operationAdminDetail(instanceId) {
    const { data, error } = await supabase.rpc("crew_operations_admin_detail", { p_instance_id: instanceId });
    throwSupabaseError("crew.operationAdminDetail", error);
    return data;
  },

  async saveOperationTemplate(outletId, template) {
    const { data, error } = await supabase.rpc("crew_operations_save_template", { p_outlet_id: outletId, p_template: template });
    throwSupabaseError("crew.saveOperationTemplate", error);
    return data;
  },

  async activateOperationTemplate(templateId) {
    const { data, error } = await supabase.rpc("crew_operations_activate_template", { p_template_id: templateId });
    throwSupabaseError("crew.activateOperationTemplate", error);
    return data;
  },

  async archiveOperationTemplate(templateId) {
    const { data, error } = await supabase.rpc("crew_operations_archive_template", { p_template_id: templateId });
    throwSupabaseError("crew.archiveOperationTemplate", error);
    return data;
  },

  async saveDailyOperationTask(outletId, task) {
    const { data, error } = await supabase.rpc("crew_operations_save_daily_task", { p_outlet_id: outletId, p_task: task });
    throwSupabaseError("crew.saveDailyOperationTask", error);
    return data;
  },

  async rewardAdminData(outletId, period, cycleId = null) {
    const { data, error } = await supabase.rpc("crew_reward_admin_data", { p_outlet_id: outletId, p_period: period, p_cycle_id: cycleId });
    throwSupabaseError("crew.rewardAdminData", error);
    return data || { cycles: [], cycle: null, entries: [], adjustments: [] };
  },

  async createRewardCampaign({ outletId, period, configuredPool, employeeIds = null, minimumPerformance = 60 }) {
    const { data, error } = await supabase.rpc("crew_reward_create_campaign", {
      p_outlet_id: outletId,
      p_period: period,
      p_configured_pool: configuredPool,
      p_employee_ids: employeeIds,
      p_minimum_performance: minimumPerformance,
    });
    throwSupabaseError("crew.createRewardCampaign", error);
    return data;
  },

  async calculateRewardCycle(cycleId) {
    const { data, error } = await supabase.rpc("crew_reward_calculate", { p_cycle_id: cycleId });
    throwSupabaseError("crew.calculateRewardCycle", error);
    return data;
  },

  async adjustRewardEntry(entryId, adjustment, reason) {
    const { data, error } = await supabase.rpc("crew_reward_adjust", { p_entry_id: entryId, p_adjustment: adjustment, p_reason: reason });
    throwSupabaseError("crew.adjustRewardEntry", error);
    return data;
  },

  async finalizeRewardCycle(cycleId) {
    const { data, error } = await supabase.rpc("crew_reward_finalize", { p_cycle_id: cycleId });
    throwSupabaseError("crew.finalizeRewardCycle", error);
    return data;
  },

  async markRewardCyclePaid(cycleId) {
    const { data, error } = await supabase.rpc("crew_reward_mark_paid", { p_cycle_id: cycleId });
    throwSupabaseError("crew.markRewardCyclePaid", error);
    return data;
  },

  async performanceAdminData(outletId, period) {
    const { data, error } = await supabase.rpc("crew_performance_admin_data", { p_outlet_id: outletId, p_period: period });
    throwSupabaseError("crew.performanceAdminData", error);
    return data || { summary: {}, crew: [], reviews: [], feedback: [] };
  },

  async submitPerformanceReview({ employeeId, period, component, criteria, note = "" }) {
    const { data, error } = await supabase.rpc("crew_performance_submit_review", {
      p_employee_id: employeeId, p_period: period, p_component: component, p_criteria: criteria, p_note: note,
    });
    throwSupabaseError("crew.submitPerformanceReview", error);
    return data;
  },

  async finalizePerformance(employeeId, period) {
    const { data, error } = await supabase.rpc("crew_performance_finalize", { p_employee_id: employeeId, p_period: period });
    throwSupabaseError("crew.finalizePerformance", error);
    return data;
  },

  async moderateFeedback(feedbackId, exclude, reason) {
    const { data, error } = await supabase.rpc("crew_feedback_moderate", { p_feedback_id: feedbackId, p_exclude: exclude, p_reason: reason });
    throwSupabaseError("crew.moderateFeedback", error);
    return data;
  },

  async publicFeedbackCrew(outletId) {
    const { data, error } = await supabase.rpc("crew_feedback_public_crew", { p_outlet_id: outletId });
    throwSupabaseError("crew.publicFeedbackCrew", error);
    return data;
  },

  async submitPublicFeedback(payload) {
    const { data, error } = await supabase.rpc("crew_feedback_submit", {
      p_outlet_id: payload.outletId,
      p_employee_id: payload.employeeId,
      p_experience: payload.experience,
      p_positive_tags: payload.positiveTags || [],
      p_improvement_tags: payload.improvementTags || [],
      p_comment: payload.comment || "",
      p_client_token: payload.clientToken,
    });
    throwSupabaseError("crew.submitPublicFeedback", error);
    return data;
  },

  async learningAssignment(token, assignmentId) {
    const { data, error } = await supabase.rpc("crew_learning_assignment", { p_token: token, p_assignment_id: assignmentId });
    throwSupabaseError("crew.learningAssignment", error);
    return data;
  },

  async learningMediaUrl(token, mediaId) {
    if (!token || !mediaId) throw new Error("Learning media is unavailable.");
    const { data, error } = await supabase.functions.invoke("crew-learning-media-url", {
      body: { token, media_id: mediaId },
    });
    throwSupabaseError("crew.learningMediaUrl", error);
    if (!data?.signed_url) throw new Error(data?.error || "Learning media is unavailable.");
    return data;
  },

  async learningMediaAdminUrl(mediaId) {
    const { data: media, error: mediaError } = await supabase
      .from("crew_learning_media")
      .select("id,bucket_id,object_path,status")
      .eq("id", mediaId)
      .single();
    throwSupabaseError("crew.learningMediaAdminUrl.media", mediaError);
    if (media.status !== "ready") throw new Error("Learning image is not ready.");
    const { data, error } = await supabase.storage.from(media.bucket_id).createSignedUrl(media.object_path, 600);
    throwSupabaseError("crew.learningMediaAdminUrl.sign", error);
    return data?.signedUrl || "";
  },

  async sopMediaUrl(token, sopVersionId, mediaId) {
    if (!token || !sopVersionId || !mediaId) throw new Error("SOP image is unavailable.");
    const { data, error } = await supabase.functions.invoke("crew-sop-media-url", {
      body: { token, sop_version_id: sopVersionId, media_id: mediaId },
    });
    throwSupabaseError("crew.sopMediaUrl", error);
    if (!data?.signed_url) throw new Error(data?.error || "SOP image is unavailable.");
    return data;
  },

  async sopMediaAdminUrl(mediaId) {
    const { data: media, error: mediaError } = await supabase
      .from("crew_sop_media")
      .select("id,bucket_id,object_path,status")
      .eq("id", mediaId)
      .single();
    throwSupabaseError("crew.sopMediaAdminUrl.media", mediaError);
    if (media.status !== "ready") throw new Error("SOP image is not ready.");
    const { data, error } = await supabase.storage.from(media.bucket_id).createSignedUrl(media.object_path, 600);
    throwSupabaseError("crew.sopMediaAdminUrl.sign", error);
    return data?.signedUrl || "";
  },

  async uploadSopMedia(file, sopVersionId) {
    validateLearningImageFile(file);
    const optimized = await optimizeImageBlob(file);
    if (optimized.blob.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error("Image exceeds 5MB limit.");
    const { data: prepared, error: prepareError } = await supabase.rpc("crew_prepare_sop_media_upload", {
      p_sop_version_id: sopVersionId,
      p_original_filename: file.name,
      p_mime_type: optimized.contentType,
      p_file_size_bytes: optimized.blob.size,
      p_width: optimized.width,
      p_height: optimized.height,
    });
    throwSupabaseError("crew.uploadSopMedia.prepare", prepareError);
    try {
      const { error: uploadError } = await supabase.storage
        .from(prepared.bucket)
        .upload(prepared.object_path, optimized.blob, {
          contentType: optimized.contentType,
          upsert: false,
          cacheControl: "3600",
        });
      throwSupabaseError("crew.uploadSopMedia.upload", uploadError);
      const { data: finalized, error: finalizeError } = await supabase.rpc("crew_finalize_sop_media_upload", {
        p_media_id: prepared.id,
      });
      throwSupabaseError("crew.uploadSopMedia.finalize", finalizeError);
      const { data: signed, error: signedError } = await supabase.storage
        .from(finalized.bucket)
        .createSignedUrl(finalized.object_path, 600);
      throwSupabaseError("crew.uploadSopMedia.preview", signedError);
      return { media: durableSopMedia(finalized), previewUrl: signed?.signedUrl || "" };
    } catch (cause) {
      try { await this.deleteSopMedia(prepared.id); } catch { /* Retain for safe retry/cleanup. */ }
      throw cause;
    }
  },

  async deleteSopMedia(mediaId) {
    if (!mediaId) return { deleted: false, reason: "missing" };
    const { data: request, error: requestError } = await supabase.rpc("crew_request_sop_media_delete", {
      p_media_id: mediaId,
    });
    throwSupabaseError("crew.deleteSopMedia.request", requestError);
    if (!request?.can_delete) return { deleted: false, reason: request?.reason || "referenced" };
    const { error: removeError } = await supabase.storage.from(request.bucket).remove([request.object_path]);
    throwSupabaseError("crew.deleteSopMedia.remove", removeError);
    const { error: finalizeError } = await supabase.rpc("crew_finalize_sop_media_delete", { p_media_id: mediaId });
    throwSupabaseError("crew.deleteSopMedia.finalize", finalizeError);
    return { deleted: true };
  },

  async resumeSopMediaCleanup(outletId) {
    if (!outletId) return { deleted: 0 };
    const { data: assets, error } = await supabase
      .from("crew_sop_media")
      .select("id,bucket_id,object_path")
      .eq("outlet_id", outletId)
      .eq("status", "deleting");
    throwSupabaseError("crew.resumeSopMediaCleanup.list", error);
    let deleted = 0;
    for (const asset of assets || []) {
      const { error: removeError } = await supabase.storage.from(asset.bucket_id).remove([asset.object_path]);
      throwSupabaseError("crew.resumeSopMediaCleanup.remove", removeError);
      const { error: finalizeError } = await supabase.rpc("crew_finalize_sop_media_delete", { p_media_id: asset.id });
      throwSupabaseError("crew.resumeSopMediaCleanup.finalize", finalizeError);
      deleted += 1;
    }
    return { deleted };
  },

  async uploadLearningMedia(file, outletId) {
    validateLearningImageFile(file);
    const optimized = await optimizeImageBlob(file);
    if (optimized.blob.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error("Image exceeds 5MB limit.");
    const { data: prepared, error: prepareError } = await supabase.rpc("crew_prepare_learning_media_upload", {
      p_outlet_id: outletId,
      p_original_filename: file.name,
      p_mime_type: optimized.contentType,
      p_file_size_bytes: optimized.blob.size,
      p_width: optimized.width,
      p_height: optimized.height,
    });
    throwSupabaseError("crew.uploadLearningMedia.prepare", prepareError);
    try {
      const { error: uploadError } = await supabase.storage
        .from(prepared.bucket)
        .upload(prepared.object_path, optimized.blob, {
          contentType: optimized.contentType,
          upsert: false,
          cacheControl: "3600",
        });
      throwSupabaseError("crew.uploadLearningMedia.upload", uploadError);
      const { data: finalized, error: finalizeError } = await supabase.rpc("crew_finalize_learning_media_upload", {
        p_media_id: prepared.id,
      });
      throwSupabaseError("crew.uploadLearningMedia.finalize", finalizeError);
      const { data: signed, error: signedError } = await supabase.storage
        .from(finalized.bucket)
        .createSignedUrl(finalized.object_path, 600);
      throwSupabaseError("crew.uploadLearningMedia.preview", signedError);
      return {
        media: durableLearningMedia(finalized),
        previewUrl: signed?.signedUrl || "",
      };
    } catch (cause) {
      try { await this.deleteLearningMedia(prepared.id); } catch { /* Retain server record for safe retry/cleanup. */ }
      throw cause;
    }
  },

  async deleteLearningMedia(mediaId) {
    if (!mediaId) return { deleted: false };
    const { data: request, error: requestError } = await supabase.rpc("crew_request_learning_media_delete", {
      p_media_id: mediaId,
    });
    throwSupabaseError("crew.deleteLearningMedia.request", requestError);
    if (!request?.can_delete) return { deleted: false, reason: request?.reason || "referenced" };
    const { error: removeError } = await supabase.storage.from(request.bucket).remove([request.object_path]);
    throwSupabaseError("crew.deleteLearningMedia.remove", removeError);
    const { error: finalizeError } = await supabase.rpc("crew_finalize_learning_media_delete", {
      p_media_id: mediaId,
    });
    throwSupabaseError("crew.deleteLearningMedia.finalize", finalizeError);
    return { deleted: true };
  },

  async sopLibrary(token) {
    const { data, error } = await supabase.rpc("crew_sop_library", { p_token: token });
    throwSupabaseError("crew.sopLibrary", error);
    return data || { categories: [], sops: [] };
  },

  async submitQuiz(token, assignmentId, quizId, answers) {
    const { data, error } = await supabase.rpc("crew_submit_quiz", { p_token: token, p_assignment_id: assignmentId, p_quiz_id: quizId, p_answers: answers });
    throwSupabaseError("crew.submitQuiz", error);
    return data;
  },

  async completeLesson(token, assignmentId, lessonId) {
    const { data, error } = await supabase.rpc("crew_complete_lesson", { p_token: token, p_assignment_id: assignmentId, p_lesson_id: lessonId });
    throwSupabaseError("crew.completeLesson", error);
    return data;
  },

  async sopVersion(token, sopVersionId) {
    const { data, error } = await supabase.rpc("crew_sop_version", { p_token: token, p_sop_version_id: sopVersionId });
    throwSupabaseError("crew.sopVersion", error);
    return data;
  },

  async acknowledgeSop(token, sopVersionId, source = "journey") {
    const { data, error } = await supabase.rpc("crew_acknowledge_sop", { p_token: token, p_sop_version_id: sopVersionId, p_source: source });
    throwSupabaseError("crew.acknowledgeSop", error);
    return data;
  },

  async listLearningAdmin() {
    const [{ data: journeys, error: journeyError }, { data: assignments, error: assignmentError }] = await Promise.all([
      supabase.from("crew_journeys").select("*, modules:crew_journey_modules(id,title,sort_order,required,status,lessons:crew_lessons(id,title,sort_order,required,estimated_minutes,blocks:crew_lesson_blocks(id,block_type,payload,sort_order),quizzes:crew_quizzes(id,title,passing_score,required,status,questions:crew_quiz_questions(id,prompt,question_type,sort_order,options:crew_quiz_options(id,label,is_correct,sort_order)))))").order("updated_at", { ascending: false }),
      supabase.from("crew_journey_assignments").select("id,journey_id,employee_id,status,due_at,assigned_at,employee:employees(id,full_name,position),journey:crew_journeys(id,name,version)").order("assigned_at", { ascending: false }).limit(100),
    ]);
    throwSupabaseError("crew.listLearningAdmin.journeys", journeyError);
    throwSupabaseError("crew.listLearningAdmin.assignments", assignmentError);
    return {
      journeys: (journeys || []).map(normalizeAdminJourney),
      assignments: assignments || [],
    };
  },

  async listOnboardingAdmin(outletId) {
    const { data, error } = await supabase.rpc("crew_admin_onboarding_list", {
      p_outlet_id: outletId,
    });
    throwSupabaseError("crew.listOnboardingAdmin", error);
    return (data || []).map(normalizeAdminJourney);
  },

  async getOnboardingAdmin(journeyId) {
    const { data, error } = await supabase.rpc("crew_admin_onboarding_detail", {
      p_journey_id: journeyId,
    });
    throwSupabaseError("crew.getOnboardingAdmin", error);
    return data ? normalizeAdminJourney(data) : null;
  },

  async onboardingProgress(outletId) {
    const { data, error } = await supabase.rpc("crew_admin_onboarding_progress", {
      p_outlet_id: outletId,
    });
    throwSupabaseError("crew.onboardingProgress", error);
    return data || [];
  },

  async createDefaultOnboarding(outletId) {
    const { data, error } = await supabase.rpc("crew_create_default_onboarding", {
      p_outlet_id: outletId,
    });
    throwSupabaseError("crew.createDefaultOnboarding", error);
    return data;
  },

  async cloneLearningSetup({ sourceOutletId, targetOutletId, copyOnboarding, copyCategories, copySops }) {
    const { data, error } = await supabase.rpc("crew_clone_learning_setup", {
      p_source_outlet_id: sourceOutletId,
      p_target_outlet_id: targetOutletId,
      p_copy_onboarding: Boolean(copyOnboarding),
      p_copy_sop_categories: Boolean(copyCategories),
      p_copy_sops: Boolean(copySops),
    });
    throwSupabaseError("crew.cloneLearningSetup", error);
    return data;
  },

  async cloneSelectedSops({ sourceOutletId, targetOutletId, sopIds, copyCategories = true }) {
    const { data, error } = await supabase.rpc("crew_clone_selected_sops", {
      p_source_outlet_id: sourceOutletId,
      p_target_outlet_id: targetOutletId,
      p_sop_ids: sopIds,
      p_copy_categories: Boolean(copyCategories),
    });
    throwSupabaseError("crew.cloneSelectedSops", error);
    for (const copy of data?.media_copies || []) {
      const { error: copyError } = await supabase.storage
        .from(copy.source_bucket)
        .copy(copy.source_path, copy.target_path);
      throwSupabaseError("crew.cloneSelectedSops.copyMedia", copyError);
      const { error: finalizeError } = await supabase.rpc("crew_finalize_sop_media_upload", { p_media_id: copy.target_id });
      throwSupabaseError("crew.cloneSelectedSops.finalizeMedia", finalizeError);
      const { error: attachError } = await supabase.rpc("crew_attach_sop_media", {
        p_section_id: copy.target_section_id,
        p_media_id: copy.target_id,
        p_caption: null,
      });
      throwSupabaseError("crew.cloneSelectedSops.attachMedia", attachError);
    }
    return data;
  },

  async sopUsageAdmin(sopId) {
    const { data, error } = await supabase.rpc("crew_admin_sop_usage", {
      p_sop_id: sopId,
    });
    throwSupabaseError("crew.sopUsageAdmin", error);
    return data || { current: [], historical: [] };
  },

  async listSopsAdmin() {
    const { data, error } = await supabase.from("crew_sops").select("*, versions:crew_sop_versions(id,version,status,effective_date,change_summary,require_acknowledgement,published_at,sections:crew_sop_sections(id,title,body,sort_order,key_point,media_url,media_id,media_caption))").order("updated_at", { ascending: false });
    throwSupabaseError("crew.listSopsAdmin", error);
    return data || [];
  },

  async listOutletSopsAdmin(outletId) {
    const { data, error } = await supabase.rpc("crew_sop_admin_library", {
      p_outlet_id: outletId,
    });
    throwSupabaseError("crew.listOutletSopsAdmin", error);
    return data || { sops: [], categories: [] };
  },

  async localizedContentAdmin(domain, versionId) {
    const { data, error } = await supabase.rpc("crew_admin_localized_content", {
      p_domain: domain,
      p_version_id: versionId,
    });
    throwSupabaseError("crew.localizedContentAdmin", error);
    return data || { domain, version_id: versionId, languages: ["en", "zh-CN", "ms"], units: {} };
  },

  async saveLocalizedContentUnits(domain, versionId, units) {
    const { data, error } = await supabase.rpc("crew_save_localized_content_units", {
      p_domain: domain,
      p_version_id: versionId,
      p_units: units.map(({ label: _label, ...unit }) => unit),
    });
    throwSupabaseError("crew.saveLocalizedContentUnits", error);
    return data;
  },

  async editLocalizedTranslation(unitId, language, value) {
    const { data, error } = await supabase.rpc("crew_edit_localized_translation", {
      p_unit_id: unitId,
      p_language: language,
      p_value: value,
    });
    throwSupabaseError("crew.editLocalizedTranslation", error);
    return data;
  },

  async reviewLocalizedTranslation(unitId, language) {
    const { data, error } = await supabase.rpc("crew_review_localized_translation", {
      p_unit_id: unitId,
      p_language: language,
    });
    throwSupabaseError("crew.reviewLocalizedTranslation", error);
    return data;
  },

  async translateLocalizedContent(domain, versionId, unitIds = null, targetLanguages = null, replaceProtected = false) {
    const { data, error } = await supabase.functions.invoke("crew-content-translate", {
      body: { domain, version_id: versionId, unit_ids: unitIds, target_languages: targetLanguages, replace_protected: replaceProtected },
    });
    throwSupabaseError("crew.translateLocalizedContent", error || (data?.error ? { message: data.error } : null));
    return data?.localization || data;
  },

  async cloneLocalizedContent(domain, sourceVersionId, targetVersionId) {
    const { data, error } = await supabase.rpc("crew_clone_localized_content", {
      p_domain: domain,
      p_source_version_id: sourceVersionId,
      p_target_version_id: targetVersionId,
    });
    throwSupabaseError("crew.cloneLocalizedContent", error);
    return data;
  },

  async localizedContentForCrew(token, domain, versionIds, language) {
    if (!versionIds?.length) return {};
    const { data, error } = await supabase.rpc("crew_localized_content", {
      p_token: token,
      p_domain: domain,
      p_version_ids: versionIds,
      p_language: language,
    });
    throwSupabaseError("crew.localizedContentForCrew", error);
    return data || {};
  },

  async getSopAdmin(sopId) {
    const { data, error } = await supabase.rpc("crew_sop_admin_detail", {
      p_sop_id: sopId,
    });
    throwSupabaseError("crew.getSopAdmin", error);
    return data || null;
  },

  async saveSopCategory(values) {
    const { id, ...payload } = values;
    const query = id
      ? supabase.from("crew_sop_categories").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id)
      : supabase.from("crew_sop_categories").insert(payload);
    const { data, error } = await query.select().single();
    throwSupabaseError("crew.saveSopCategory", error);
    return data;
  },

  async manageSopCategory({ outletId, action, categoryId = null, name = null, sortOrder = null }) {
    const { data, error } = await supabase.rpc("crew_manage_sop_category", {
      p_outlet_id: outletId,
      p_action: action,
      p_category_id: categoryId,
      p_name: name,
      p_sort_order: sortOrder,
    });
    throwSupabaseError("crew.manageSopCategory", error);
    return data;
  },

  async saveJourney(values) {
    const { id, ...payload } = values;
    const query = id ? supabase.from("crew_journeys").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id) : supabase.from("crew_journeys").insert(payload);
    const { data, error } = await query.select().single();
    throwSupabaseError("crew.saveJourney", error);
    return data;
  },

  async saveSop(values) {
    const { id, ...payload } = values;
    const query = id ? supabase.from("crew_sops").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id) : supabase.from("crew_sops").insert(payload);
    const { data, error } = await query.select().single();
    throwSupabaseError("crew.saveSop", error);
    return data;
  },

  async saveDraftRecord(table, values) {
    const { id, ...payload } = values;
    const query = id ? supabase.from(table).update(payload).eq("id", id) : supabase.from(table).insert(payload);
    const { data, error } = await query.select().single();
    throwSupabaseError(`crew.saveDraftRecord.${table}`, error);
    return data;
  },

  async deleteDraftRecord(table, id) {
    if (table === "crew_sop_versions") await this.cleanupSopDraftMedia(id);
    if (table === "crew_sops") {
      const { data: versions, error: versionError } = await supabase
        .from("crew_sop_versions").select("id").eq("sop_id", id).eq("status", "draft");
      throwSupabaseError("crew.deleteDraftRecord.sopVersions", versionError);
      for (const version of versions || []) await this.cleanupSopDraftMedia(version.id);
    }
    const { error } = await supabase.from(table).delete().eq("id", id);
    throwSupabaseError(`crew.deleteDraftRecord.${table}`, error);
  },

  async cleanupSopDraftMedia(sopVersionId) {
    const { data, error } = await supabase.rpc("crew_prepare_sop_draft_media_cleanup", { p_sop_version_id: sopVersionId });
    throwSupabaseError("crew.cleanupSopDraftMedia.prepare", error);
    for (const asset of data?.assets || []) {
      const { error: removeError } = await supabase.storage.from(asset.bucket).remove([asset.object_path]);
      throwSupabaseError("crew.cleanupSopDraftMedia.remove", removeError);
      const { error: finalizeError } = await supabase.rpc("crew_finalize_sop_media_delete", { p_media_id: asset.id });
      throwSupabaseError("crew.cleanupSopDraftMedia.finalize", finalizeError);
    }
    return true;
  },

  async swapDraftOrder(table, first, second) {
    const temporaryOrder = -1000000 - Math.abs(Number(first.sort_order || 0));
    const updates = [
      [first.id, temporaryOrder],
      [second.id, Number(first.sort_order)],
      [first.id, Number(second.sort_order)],
    ];
    for (const [id, sortOrder] of updates) {
      const { error } = await supabase
        .from(table)
        .update({ sort_order: sortOrder })
        .eq("id", id);
      throwSupabaseError(`crew.swapDraftOrder.${table}`, error);
    }
  },

  async saveSopDraftSections(sopVersionId, sections, originalIds = [], originalMediaIds = []) {
    const retainedIds = new Set(sections.map((section) => section.id).filter((id) => id && !String(id).startsWith("temp:")));
    const removedIds = originalIds.filter((id) => !retainedIds.has(id));
    const existing = sections.filter((section) => retainedIds.has(section.id));
    for (const [index, section] of existing.entries()) {
      const { error } = await supabase
        .from("crew_sop_sections")
        .update({ sort_order: -1000000 - index })
        .eq("id", section.id)
        .eq("sop_version_id", sopVersionId);
      throwSupabaseError("crew.saveSopDraftSections.prepare", error);
    }
    if (removedIds.length) {
      const { error } = await supabase
        .from("crew_sop_sections")
        .delete()
        .eq("sop_version_id", sopVersionId)
        .in("id", removedIds);
      throwSupabaseError("crew.saveSopDraftSections.delete", error);
    }
    const saved = [];
    for (const [index, section] of sections.entries()) {
      const payload = {
        sop_version_id: sopVersionId,
        title: section.title.trim(),
        body: section.body || null,
        sort_order: index + 1,
        key_point: Boolean(section.key_point),
        media_url: null,
        media_id: section.media?.id || section.media_id || null,
        media_caption: String(section.media?.caption ?? section.media_caption ?? "").trim() || null,
      };
      const query = retainedIds.has(section.id)
        ? supabase.from("crew_sop_sections").update(payload).eq("id", section.id).eq("sop_version_id", sopVersionId)
        : supabase.from("crew_sop_sections").insert(payload);
      const { data, error } = await query.select().single();
      throwSupabaseError("crew.saveSopDraftSections.save", error);
      saved.push(data);
    }
    const retainedMedia = new Set(saved.map((section) => section.media_id).filter(Boolean));
    for (const mediaId of originalMediaIds.filter(Boolean)) {
      if (!retainedMedia.has(mediaId)) await this.deleteSopMedia(mediaId);
    }
    return saved;
  },

  async saveOnboardingDraft(originalJourney, nextJourney) {
    if (!originalJourney?.id || originalJourney.status !== "draft" || originalJourney.id !== nextJourney?.id) {
      throw new Error("Only the active onboarding draft can be saved.");
    }

    const originalMedia = learningMediaIds(originalJourney);
    const nextMedia = learningMediaIds(nextJourney);
    const originalModules = originalJourney.modules || [];
    const nextModules = nextJourney.modules || [];
    await prepareCrewDraftOrder("crew_journey_modules", nextModules);
    for (const module of nextModules) {
      await prepareCrewDraftOrder("crew_lessons", module.lessons || []);
      for (const lesson of module.lessons || []) {
        await prepareCrewDraftOrder("crew_lesson_blocks", lesson.blocks || []);
        for (const quiz of lesson.quizzes || []) {
          await prepareCrewDraftOrder("crew_quiz_questions", quiz.questions || []);
          for (const question of quiz.questions || []) await prepareCrewDraftOrder("crew_quiz_options", question.options || []);
        }
      }
    }

    await deleteRemovedCrewDraftRows("crew_lessons", originalModules.flatMap((module) => module.lessons || []), nextModules.flatMap((module) => module.lessons || []));
    const originalLessons = originalModules.flatMap((module) => module.lessons || []);
    const nextLessons = nextModules.flatMap((module) => module.lessons || []);
    await deleteRemovedCrewDraftRows("crew_lesson_blocks", originalLessons.flatMap((lesson) => lesson.blocks || []), nextLessons.flatMap((lesson) => lesson.blocks || []));
    await deleteRemovedCrewDraftRows("crew_quizzes", originalLessons.flatMap((lesson) => lesson.quizzes || []), nextLessons.flatMap((lesson) => lesson.quizzes || []));
    await deleteRemovedCrewDraftRows("crew_quiz_questions", originalLessons.flatMap((lesson) => lesson.quizzes || []).flatMap((quiz) => quiz.questions || []), nextLessons.flatMap((lesson) => lesson.quizzes || []).flatMap((quiz) => quiz.questions || []));
    await deleteRemovedCrewDraftRows("crew_quiz_options", originalLessons.flatMap((lesson) => lesson.quizzes || []).flatMap((quiz) => quiz.questions || []).flatMap((question) => question.options || []), nextLessons.flatMap((lesson) => lesson.quizzes || []).flatMap((quiz) => quiz.questions || []).flatMap((question) => question.options || []));

    for (const [moduleIndex, module] of nextModules.entries()) {
      const savedModule = await saveCrewDraftRow("crew_journey_modules", module, {
        journey_id: nextJourney.id,
        title: module.title.trim(),
        description: module.description?.trim() || null,
        sort_order: moduleIndex + 1,
        estimated_minutes: Number(module.estimated_minutes || 0),
        required: Boolean(module.required),
        status: "draft",
      });
      module.id = savedModule.id;

      for (const [lessonIndex, lesson] of (module.lessons || []).entries()) {
        const savedLesson = await saveCrewDraftRow("crew_lessons", lesson, {
          module_id: savedModule.id,
          title: lesson.title.trim(),
          sort_order: lessonIndex + 1,
          content_type: lesson.content_type || "lesson",
          required: Boolean(lesson.required),
          estimated_minutes: Number(lesson.estimated_minutes || 0),
        });
        lesson.id = savedLesson.id;

        for (const [blockIndex, block] of (lesson.blocks || []).entries()) {
          const payload = { ...(block.payload || {}) };
          delete payload.pending_image;
          if (payload.media) payload.media = durableLearningMedia(payload.media);
          else delete payload.media;
          const savedBlock = await saveCrewDraftRow("crew_lesson_blocks", block, {
            lesson_id: savedLesson.id,
            block_type: block.block_type,
            payload,
            sort_order: blockIndex + 1,
          });
          block.id = savedBlock.id;
        }

        for (const quiz of lesson.quizzes || []) {
          const savedQuiz = await saveCrewDraftRow("crew_quizzes", quiz, {
            lesson_id: savedLesson.id,
            title: quiz.title.trim(),
            passing_score: Number(quiz.passing_score || 0),
            required: Boolean(quiz.required),
            status: "draft",
          });
          quiz.id = savedQuiz.id;
          for (const [questionIndex, question] of (quiz.questions || []).entries()) {
            const savedQuestion = await saveCrewDraftRow("crew_quiz_questions", question, {
              quiz_id: savedQuiz.id,
              prompt: question.prompt.trim(),
              question_type: question.question_type,
              explanation: question.explanation?.trim() || null,
              sort_order: questionIndex + 1,
            });
            question.id = savedQuestion.id;
            for (const [optionIndex, option] of (question.options || []).entries()) {
              const savedOption = await saveCrewDraftRow("crew_quiz_options", option, {
                question_id: savedQuestion.id,
                label: option.label.trim(),
                is_correct: Boolean(option.is_correct),
                sort_order: optionIndex + 1,
              });
              option.id = savedOption.id;
            }
          }
        }
      }
    }

    for (const mediaId of originalMedia) {
      if (!nextMedia.has(mediaId)) await this.deleteLearningMedia(mediaId);
    }
    const versions = await this.listOnboardingAdmin(nextJourney.outlet_id);
    return versions.find((journey) => journey.id === nextJourney.id) || nextJourney;
  },

  async assignJourney(employeeId, journeyId, dueAt = null) {
    const { data, error } = await supabase.rpc("assign_crew_journey", { p_employee_id: employeeId, p_journey_id: journeyId, p_due_at: dueAt || null });
    throwSupabaseError("crew.assignJourney", error);
    return data;
  },

  async publishJourney(journeyId) {
    const { data, error } = await supabase.rpc("crew_publish_journey", { p_journey_id: journeyId });
    throwSupabaseError("crew.publishJourney", error);
    return data;
  },

  async newJourneyVersion(journeyId) {
    const { data, error } = await supabase.rpc("crew_new_journey_version", { p_journey_id: journeyId });
    throwSupabaseError("crew.newJourneyVersion", error);
    if (data && data !== journeyId) await this.cloneLocalizedContent("onboarding", journeyId, data);
    return data;
  },

  async publishSopVersion(sopVersionId) {
    const { data, error } = await supabase.rpc("crew_publish_sop_version", { p_sop_version_id: sopVersionId });
    throwSupabaseError("crew.publishSopVersion", error);
    return data;
  },

  async newSopVersion(sopId, sourceVersionId = null) {
    const { data, error } = await supabase.rpc("crew_new_sop_version", { p_sop_id: sopId });
    throwSupabaseError("crew.newSopVersion", error);
    if (sourceVersionId && data !== sourceVersionId) await this.cloneLocalizedContent("sop", sourceVersionId, data);
    return data;
  },
  async manageAccess(employeeId, action, passcode = "") {
    const { data, error } = await supabase.rpc("manage_crew_access", {
      p_employee_id: employeeId,
      p_action: action,
      p_passcode: passcode || null,
    });
    throwSupabaseError("crew.manageAccess", error);
    return data;
  },
  async updateCashOperationsAccess(employeeId, canInitiateHandover) {
    const { data, error } = await supabase.rpc("crew_update_cash_operations_access", {
      p_employee_id: employeeId,
      p_can_initiate_handover: Boolean(canInitiateHandover),
    });
    throwSupabaseError("crew.updateCashOperationsAccess", error);
    return data;
  },

  async signIn(mobile, passcode) {
    const { data, error } = await supabase.rpc("crew_authenticate", {
      p_mobile: mobile,
      p_passcode: passcode,
      p_ip_hash: null,
    });
    throwSupabaseError("crew.signIn", error);
    return data;
  },

  async attendanceContext(token) {
    const { data, error } = await supabase.rpc("crew_attendance_context", { p_token: token });
    throwSupabaseError("crew.attendanceContext", error);
    return data;
  },

  async clock(token, action, location = null, exceptionReason = "") {
    const { data, error } = await supabase.rpc("crew_clock", {
      p_token: token,
      p_action: action,
      p_location: location,
      p_exception_reason: exceptionReason || null,
    });
    throwSupabaseError("crew.clock", error);
    return data;
  },

  async changePasscode(token, currentPasscode, newPasscode) {
    const { data, error } = await supabase.rpc("crew_change_passcode", {
      p_token: token,
      p_current_passcode: currentPasscode,
      p_new_passcode: newPasscode,
    });
    throwSupabaseError("crew.changePasscode", error);
    return data;
  },

  async myAttendance(token) {
    const { data, error } = await supabase.rpc("crew_my_attendance", { p_token: token, p_limit: 60 });
    throwSupabaseError("crew.myAttendance", error);
    return data || [];
  },

  async myAttendanceMonth(token, month) {
    const { data, error } = await supabase.rpc("crew_my_attendance_month", { p_token: token, p_month: month });
    throwSupabaseError("crew.myAttendanceMonth", error);
    return data || [];
  },

  async myProfile(token) {
    const { data, error } = await supabase.rpc("crew_my_profile", { p_token: token });
    throwSupabaseError("crew.myProfile", error);
    return data || null;
  },

  async listAttendance({ from: requestedFrom, to: requestedTo, outletId = null } = {}) {
    const today = localBusinessDate();
    const fallbackFrom = new Date(`${today}T00:00:00`);
    fallbackFrom.setDate(fallbackFrom.getDate() - 90);
    const { data, error } = await supabase.rpc("crew_attendance_admin_with_roster", {
      p_from: requestedFrom || localBusinessDate(fallbackFrom),
      p_to: requestedTo || today,
      p_outlet_id: outletId || null,
    });
    throwSupabaseError("crew.listAttendance", error);
    return data || [];
  },

  async growthAdminData(outletId) {
    const { data, error } = await supabase.rpc("crew_growth_admin_data", { p_outlet_id: outletId });
    throwSupabaseError("crew.growthAdminData", error);
    return data || { skills: [], crew: [], reviews: [], recent_certifications: [] };
  },

  async growthAdminEvidence(outletId) {
    const { data, error } = await supabase.rpc("crew_growth_admin_evidence", { p_outlet_id: outletId });
    throwSupabaseError("crew.growthAdminEvidence", error);
    return data || [];
  },

  async saveGrowthSkill(skill) {
    const { data, error } = await supabase.rpc("crew_growth_save_skill", { p_skill: skill });
    throwSupabaseError("crew.saveGrowthSkill", error);
    return data;
  },

  async submitGrowthAssessment({ employeeId, skillId, result, checklist, note = "" }) {
    const { data, error } = await supabase.rpc("crew_growth_submit_assessment", {
      p_employee_id: employeeId,
      p_skill_id: skillId,
      p_result: result,
      p_checklist: checklist,
      p_note: note || null,
    });
    throwSupabaseError("crew.submitGrowthAssessment", error);
    return data;
  },

  async certifyGrowthSkill({ employeeId, skillId, note = "" }) {
    const { data, error } = await supabase.rpc("crew_growth_certify", {
      p_employee_id: employeeId,
      p_skill_id: skillId,
      p_note: note || null,
    });
    throwSupabaseError("crew.certifyGrowthSkill", error);
    return data;
  },
};
