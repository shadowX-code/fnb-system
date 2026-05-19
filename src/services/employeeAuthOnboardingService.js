import { supabase } from "../lib/supabase";

function formatFunctionError(error) {
  if (!error) return "Unable to send login setup email.";
  return error.message || String(error);
}

export const employeeAuthOnboardingService = {
  async sendLoginSetupEmail(employeeId, { allowManualLink = false } = {}) {
    const { data, error } = await supabase.functions.invoke("employee-auth-onboarding", {
      body: {
        employee_id: employeeId,
        allow_manual_link: allowManualLink,
      },
    });

    if (error) {
      console.error("[Supabase:functions.employee-auth-onboarding]", error);
      let payload = null;
      try {
        payload = typeof error.context?.json === "function" ? await error.context.json() : null;
      } catch {
        payload = null;
      }
      const setupError = new Error(payload?.error || formatFunctionError(error));
      setupError.code = payload?.code;
      setupError.manual_link = payload?.manual_link;
      throw setupError;
    }

    if (data?.error) {
      const setupError = new Error(data.error);
      setupError.code = data.code;
      setupError.manual_link = data.manual_link;
      throw setupError;
    }

    return data;
  },
};
