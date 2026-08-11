import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function findAuthUsersByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  let page = 1;
  const perPage = 100;
  const matches: Array<{ id: string; email?: string }> = [];
  while (page <= 20) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    matches.push(...data.users.filter((item) => normalizeEmail(item.email) === email));
    if (data.users.length < perPage) return matches;
    page += 1;
  }
  return matches;
}

function identityConflict(message: string) {
  return json({ ok: false, code: "IDENTITY_CONFLICT", message }, 409);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    return await handleRequest(request);
  } catch (error) {
    console.error("employee-auth-onboarding failed", error);
    return json({
      ok: false,
      code: "UNHANDLED_ERROR",
      message: "Unable to complete login setup. Please try again or contact admin.",
    }, 500);
  }
});

async function handleRequest(request: Request) {
  const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("PROJECT_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = Deno.env.get("FEEDX_SITE_URL") || Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    const missing = [
      !supabaseUrl ? "PROJECT_URL or SUPABASE_URL" : null,
      !anonKey ? "SUPABASE_ANON_KEY" : null,
      !serviceRoleKey ? "PROJECT_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY" : null,
    ].filter(Boolean);

    return json({
      ok: false,
      code: "ENV_MISSING",
      message: `Login setup is not configured. Missing: ${missing.join(", ")}.`,
    }, 500);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization) return json({ error: "Missing authorization header." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const body = await request.json().catch(() => ({}));
  const employeeId = body.employee_id;
  const modeRequest = String(body.mode ?? "").trim();
  const manualLinkRequested = modeRequest === "manual_link" || Boolean(body.allow_manual_link);
  if (!employeeId) {
    return json({
      ok: false,
      code: "EMPLOYEE_REQUIRED",
      message: "Employee is required.",
    }, 400);
  }

  const { data: employee, error: employeeError } = await adminClient
    .from("employees")
    .select("id,email,full_name,role_id,auth_user_id,enable_system_login,access_state")
    .eq("id", employeeId)
    .maybeSingle();
  if (employeeError) {
    return json({
      ok: false,
      code: "EMPLOYEE_LOOKUP_FAILED",
      message: "Unable to load employee details.",
    }, 500);
  }
  if (!employee) {
    return json({
      ok: false,
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee was not found.",
    }, 404);
  }
  if (!employee.role_id) {
    return json({
      ok: false,
      code: "ROLE_REQUIRED",
      message: "Assign a role before sending login setup email.",
    }, 400);
  }

  const accessState = String(employee.access_state ?? "").trim().toLowerCase();
  const requiresResetPermission = accessState === "active";
  const requiredPermission = requiresResetPermission ? "employees.reset_password" : "employees.enable_login";
  const { data: permissionResult, error: permissionError } = await userClient.rpc("current_user_has_permission", {
    permission_code: requiredPermission,
  });
  if (permissionError) {
    return json({
      ok: false,
      code: manualLinkRequested ? "MANUAL_LINK_PERMISSION_CHECK_FAILED" : "PERMISSION_CHECK_FAILED",
      message: "Unable to verify your access. Please try again or contact admin.",
    }, 403);
  }
  if (!permissionResult) {
    return json({
      ok: false,
      code: manualLinkRequested ? "MANUAL_LINK_PERMISSION_DENIED" : "PERMISSION_DENIED",
      message: requiresResetPermission
        ? "You do not have permission to send employee reset password emails."
        : "You do not have permission to manage employee login access.",
    }, 403);
  }

  const email = normalizeEmail(employee.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({
      ok: false,
      code: "VALID_EMAIL_REQUIRED",
      message: "Employee must have a valid email before login setup.",
    }, 400);
  }

  const redirectTo = siteUrl ? `${siteUrl.replace(/\/$/, "")}/setup-password` : undefined;
  const emailMatches = await findAuthUsersByEmail(adminClient, email);
  if (emailMatches.length > 1) {
    return identityConflict("More than one Auth account matches this employee login email.");
  }
  const existingUser = emailMatches[0] ?? null;
  let authUser = existingUser;

  if (employee.auth_user_id) {
    const { data: linkedResult, error: linkedError } = await adminClient.auth.admin.getUserById(employee.auth_user_id);
    if (linkedError || !linkedResult?.user) {
      return identityConflict("The employee has an invalid linked Auth account. Resolve the identity link before sending setup.");
    }
    if (normalizeEmail(linkedResult.user.email) !== email) {
      return identityConflict("The linked Auth account uses a different email. Use a dedicated identity change flow before sending setup.");
    }
    if (existingUser && existingUser.id !== employee.auth_user_id) {
      return identityConflict("The requested login email belongs to a different Auth account.");
    }
    authUser = linkedResult.user;
  }

  if (authUser) {
    const { data: linkedEmployee, error: linkedEmployeeError } = await adminClient
      .from("employees")
      .select("id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();
    if (linkedEmployeeError) {
      return json({ ok: false, code: "AUTH_LINK_LOOKUP_FAILED", message: "Unable to verify the existing Auth link." }, 500);
    }
    if (linkedEmployee && linkedEmployee.id !== employee.id) {
      return identityConflict("This Auth account is already linked to a different employee.");
    }
  }
  let mode: "email" | "manual_link" = "email";
  let setupUrl: string | null = null;

  if (manualLinkRequested) {
    try {
      const manual = await generateManualSetupLink(adminClient, {
        email,
        employee,
          existingUser: authUser,
        redirectTo,
      });
      setupUrl = manual.setupUrl;
      authUser = manual.authUser;
      mode = "manual_link";
    } catch (manualLinkError) {
      console.error("Unable to generate manual login setup link", manualLinkError);
      return json({
        ok: false,
        code: "MANUAL_LINK_FAILED",
        message: "Unable to generate a login setup link. Please try again or contact admin.",
      }, 500);
    }
  } else {
    try {
      if (!authUser) {
        const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { employee_id: employee.id, full_name: employee.full_name },
          redirectTo,
        });
        if (error) {
          const raceMatches = await findAuthUsersByEmail(adminClient, email);
          if (raceMatches.length === 1) {
            authUser = raceMatches[0];
          } else {
            throw error;
          }
        }
        authUser = authUser ?? data.user;
      } else {
        const { error } = await userClient.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
      }
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : String(emailError);
      const likelyEmailConfigIssue = /smtp|email|mail|provider|not configured|sending/i.test(message);

      if (likelyEmailConfigIssue) {
        return json({
          ok: false,
          code: "SMTP_NOT_CONFIGURED",
          message: "Email sending is not configured.",
          canGenerateManualLink: true,
        });
      }

      return json({
        ok: false,
        code: "AUTH_EMAIL_FAILED",
        message,
        canGenerateManualLink: true,
      }, 500);
    }
  }

  if (!authUser?.id) {
    return json({ ok: false, code: "AUTH_ACCOUNT_MISSING", message: "Unable to resolve the employee Auth account." }, 500);
  }

  const { data: linkedEmployee, error: linkedEmployeeError } = await adminClient
    .from("employees")
    .select("id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();
  if (linkedEmployeeError) {
    return json({ ok: false, code: "AUTH_LINK_LOOKUP_FAILED", message: "Unable to verify the Auth link." }, 500);
  }
  if (linkedEmployee && linkedEmployee.id !== employee.id) {
    return identityConflict("This Auth account is already linked to a different employee.");
  }

  const { data: updatedEmployee, error: updateError } = await adminClient
    .from("employees")
    .update({
      auth_user_id: authUser?.id ?? null,
      enable_system_login: true,
      access_state: "invited",
      email_verified: false,
      is_active: true,
      verification_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", employee.id)
    .or(`auth_user_id.is.null,auth_user_id.eq.${authUser.id}`)
    .select("id,auth_user_id")
    .maybeSingle();
  if (updateError) {
    return json({ ok: false, code: "EMPLOYEE_LINK_UPDATE_FAILED", message: "Login setup was sent, but the employee Auth link could not be updated safely." }, 500);
  }
  if (!updatedEmployee || updatedEmployee.auth_user_id !== authUser.id) {
    return identityConflict("The employee Auth link changed while login setup was being processed.");
  }

  const { error: auditError } = await adminClient.from("audit_logs").insert({
    action: "employee_login_setup_sent",
    module: "people",
    description: `Login setup ${mode === "manual_link" ? "manual setup link" : "email"} sent to ${email}.`,
    metadata: { target: employee.full_name, employee_id: employee.id, email, mode },
  });

  return json({
    ok: true,
    mode,
    message: mode === "manual_link" ? "Manual setup link generated." : "Login setup email sent.",
    warning: auditError ? "Login setup completed, but audit activity could not be recorded." : undefined,
    setupUrl,
    setupLink: setupUrl,
    email,
    employeeId: employee.id,
    employee_id: employee.id,
    authUserId: authUser?.id ?? null,
    auth_user_id: authUser?.id ?? null,
    accessState: "invited",
    access_state: "invited",
  });
}

function dataToLink(data: unknown) {
  const value = data as { properties?: { action_link?: string; email_otp?: string }; action_link?: string };
  return value?.properties?.action_link ?? value?.action_link ?? null;
}

async function generateManualSetupLink(
  adminClient: ReturnType<typeof createClient>,
  {
    email,
    employee,
    existingUser,
    redirectTo,
  }: {
    email: string;
    employee: { id: string; full_name?: string };
    existingUser: { id: string } | null;
    redirectTo?: string;
  },
) {
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: existingUser ? "recovery" : "invite",
    email,
    options: {
      data: { employee_id: employee.id, full_name: employee.full_name },
      redirectTo,
    },
  });
  if (error) throw error;

  const setupUrl = dataToLink(data);
  if (!setupUrl) throw new Error("Supabase did not return a setup link.");

  return {
    setupUrl,
    authUser: data.user ?? existingUser,
  };
}
