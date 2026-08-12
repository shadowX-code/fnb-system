import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

export const CREW_ACCESS_STATE_LABEL = {
  active: "Active",
  disabled: "Disabled",
  locked: "Locked",
  not_enabled: "Not Enabled",
};

export function crewAccessState(access) {
  return access?.access_state || "not_enabled";
}

export const crewService = {
  async learningHome(token) {
    const { data, error } = await supabase.rpc("crew_learning_home", { p_token: token });
    throwSupabaseError("crew.learningHome", error);
    return data || { assignment: null, required_sops: [] };
  },

  async learningAssignment(token, assignmentId) {
    const { data, error } = await supabase.rpc("crew_learning_assignment", { p_token: token, p_assignment_id: assignmentId });
    throwSupabaseError("crew.learningAssignment", error);
    return data;
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
    return { journeys: journeys || [], assignments: assignments || [] };
  },

  async listOnboardingAdmin(outletId) {
    const { data, error } = await supabase
      .from("crew_journeys")
      .select(
        "*, modules:crew_journey_modules(id,title,description,sort_order,estimated_minutes,required,status,lessons:crew_lessons(id,title,sort_order,content_type,required,estimated_minutes,blocks:crew_lesson_blocks(id,block_type,payload,sort_order),quizzes:crew_quizzes(id,title,passing_score,required,status,questions:crew_quiz_questions(id,prompt,question_type,explanation,sort_order,options:crew_quiz_options(id,label,is_correct,sort_order)))))",
      )
      .eq("outlet_id", outletId)
      .eq("is_mandatory_onboarding", true)
      .order("version", { ascending: false });
    throwSupabaseError("crew.listOnboardingAdmin", error);
    return data || [];
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

  async listSopsAdmin() {
    const { data, error } = await supabase.from("crew_sops").select("*, versions:crew_sop_versions(id,version,status,effective_date,change_summary,require_acknowledgement,published_at,sections:crew_sop_sections(id,title,body,sort_order,key_point))").order("updated_at", { ascending: false });
    throwSupabaseError("crew.listSopsAdmin", error);
    return data || [];
  },

  async listOutletSopsAdmin(outletId) {
    const [{ data: sops, error: sopError }, { data: categories, error: categoryError }] =
      await Promise.all([
        supabase
          .from("crew_sops")
          .select(
            "*, versions:crew_sop_versions(id,version,status,effective_date,change_summary,require_acknowledgement,published_at,sections:crew_sop_sections(id,title,body,sort_order,key_point))",
          )
          .eq("outlet_id", outletId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("crew_sop_categories")
          .select("id,outlet_id,name,sort_order,created_at,updated_at")
          .eq("outlet_id", outletId)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
      ]);
    throwSupabaseError("crew.listOutletSopsAdmin.sops", sopError);
    throwSupabaseError("crew.listOutletSopsAdmin.categories", categoryError);
    return { sops: sops || [], categories: categories || [] };
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
    const { error } = await supabase.from(table).delete().eq("id", id);
    throwSupabaseError(`crew.deleteDraftRecord.${table}`, error);
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
    return data;
  },

  async publishSopVersion(sopVersionId) {
    const { data, error } = await supabase.rpc("crew_publish_sop_version", { p_sop_version_id: sopVersionId });
    throwSupabaseError("crew.publishSopVersion", error);
    return data;
  },

  async newSopVersion(sopId) {
    const { data, error } = await supabase.rpc("crew_new_sop_version", { p_sop_id: sopId });
    throwSupabaseError("crew.newSopVersion", error);
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

  async listAttendance() {
    const { data, error } = await supabase
      .from("crew_attendance_records")
      .select("*, employee:employees(id,full_name,nickname,position,workplace), outlet:outlets(id,name)")
      .order("clock_in_at", { ascending: false })
      .limit(200);
    throwSupabaseError("crew.listAttendance", error);
    return data || [];
  },
};
