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

const relationRows = (value) => (Array.isArray(value) ? value : value ? [value] : []);

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
    return {
      journeys: (journeys || []).map(normalizeAdminJourney),
      assignments: assignments || [],
    };
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
    return (data || []).map(normalizeAdminJourney);
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
    const { data, error } = await supabase.from("crew_sops").select("*, versions:crew_sop_versions(id,version,status,effective_date,change_summary,require_acknowledgement,published_at,sections:crew_sop_sections(id,title,body,sort_order,key_point,media_url))").order("updated_at", { ascending: false });
    throwSupabaseError("crew.listSopsAdmin", error);
    return data || [];
  },

  async listOutletSopsAdmin(outletId) {
    const [{ data: sops, error: sopError }, { data: categories, error: categoryError }] =
      await Promise.all([
        supabase
          .from("crew_sops")
          .select(
            "*, versions:crew_sop_versions(id,version,status,effective_date,change_summary,require_acknowledgement,published_at,sections:crew_sop_sections(id,title,body,sort_order,key_point,media_url))",
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

  async saveSopDraftSections(sopVersionId, sections, originalIds = []) {
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
        media_url: section.media_url || null,
      };
      const query = retainedIds.has(section.id)
        ? supabase.from("crew_sop_sections").update(payload).eq("id", section.id).eq("sop_version_id", sopVersionId)
        : supabase.from("crew_sop_sections").insert(payload);
      const { data, error } = await query.select().single();
      throwSupabaseError("crew.saveSopDraftSections.save", error);
      saved.push(data);
    }
    return saved;
  },

  async saveOnboardingDraft(originalJourney, nextJourney) {
    if (!originalJourney?.id || originalJourney.status !== "draft" || originalJourney.id !== nextJourney?.id) {
      throw new Error("Only the active onboarding draft can be saved.");
    }

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
