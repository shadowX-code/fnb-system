import { supabase } from "../lib/supabase";

function formatFunctionError(error) {
  if (!error) return "Unable to send login setup email.";
  return error.message || String(error);
}

export const employeeAuthOnboardingService = {
  async sendLoginSetupEmail(employeeId, { mode = "email" } = {}) {
    const { data, error } = await supabase.functions.invoke("employee-auth-onboarding", {
      body: {
        employee_id: employeeId,
        mode,
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
      setupError.canGenerateManualLink = Boolean(payload?.canGenerateManualLink);
      setupError.setupUrl = payload?.setupUrl;
      throw setupError;
    }

    if (data?.ok === false || data?.error) {
      const setupError = new Error(data.message || data.error || "Unable to send login setup email.");
      setupError.code = data.code;
      setupError.canGenerateManualLink = Boolean(data.canGenerateManualLink);
      setupError.setupUrl = data.setupUrl;
      throw setupError;
    }

    return data;
  },
};
