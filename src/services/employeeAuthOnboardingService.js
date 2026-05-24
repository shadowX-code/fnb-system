import { supabase } from "../lib/supabase";

function formatFunctionError(error) {
  if (!error) return "Unable to send login setup email.";
  return error.message || String(error);
}

async function parseFunctionErrorPayload(error) {
  const context = error?.context;
  try {
    if (typeof context?.json === "function") return await context.json();
    if (typeof context?.text === "function") {
      const text = await context.text();
      return text ? JSON.parse(text) : null;
    }
  } catch (parseError) {
    console.warn("[Supabase:functions.employee-auth-onboarding] Unable to parse error response", parseError);
  }
  return null;
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
      const payload = await parseFunctionErrorPayload(error);
      console.error("[Supabase:functions.employee-auth-onboarding]", {
        status: error.context?.status,
        message: error.message,
        payload,
      });
      if (payload?.ok === true) return payload;
      const setupError = new Error(payload?.message || payload?.error || formatFunctionError(error));
      setupError.code = payload?.code;
      setupError.canGenerateManualLink = Boolean(payload?.canGenerateManualLink);
      setupError.setupUrl = payload?.setupLink || payload?.setupUrl;
      throw setupError;
    }

    if (data?.ok === false || data?.error) {
      console.error("[Supabase:functions.employee-auth-onboarding] rejected", {
        code: data.code,
        message: data.message || data.error,
        data,
      });
      const setupError = new Error(data.message || data.error || "Unable to send login setup email.");
      setupError.code = data.code;
      setupError.canGenerateManualLink = Boolean(data.canGenerateManualLink);
      setupError.setupUrl = data.setupLink || data.setupUrl;
      throw setupError;
    }

    return {
      ...data,
      setupUrl: data?.setupLink || data?.setupUrl,
      setupLink: data?.setupLink || data?.setupUrl,
    };
  },
};
