# FeedX SMTP Readiness Report

Date: 1 June 2026  
Audit time: 23:52 MYT  
Environment: Production Supabase + Production Vercel  
Production Supabase project: `fnb-system`  
Production project ref: `oyfobxdoyfuzsodogpgs`

## Decision

Status: **BLOCKED**

Reason: production Auth email delivery is not verified. The available CLI/API checks show that FeedX and Supabase Auth accept the forgot-password/reset request, but the reported setup email was not delivered and the Supabase Dashboard-only SMTP settings/provider logs were not directly inspectable from this environment.

## Summary

| Check | Result | Notes |
|---|---:|---|
| Production project ref | Pass | `supabase/.temp/project-ref` = `oyfobxdoyfuzsodogpgs` |
| Onboarding Edge Function deployed | Pass | `employee-auth-onboarding`, status `ACTIVE`, version `5`, `verify_jwt=true` |
| Edge Function required secrets present | Partial Pass | Secret names exist for Supabase URL/keys and `FEEDX_SITE_URL`; secret values are masked by Supabase CLI |
| Forgot-password Auth API request | Pass at API layer | `/auth/v1/recover` returned HTTP 200 `{}` |
| Redirect URL rejection | Not observed | Test used `https://fnb-system.vercel.app/setup-password`; Supabase did not reject it |
| Application-side exception | Not observed | Direct Auth request succeeded; setup email app flow has fallback handling for SMTP errors |
| SMTP/custom provider configuration | Not verified | Supabase CLI does not expose Dashboard SMTP settings |
| Email template configuration | Not verified | Dashboard-only from this audit environment |
| Actual inbox delivery | Fail / unverified | Operator reported setup email was not delivered |

## Evidence Collected

### Production Project

```text
Project: fnb-system
Project ref: oyfobxdoyfuzsodogpgs
```

### Edge Function

Production function list shows:

```text
employee-auth-onboarding
status: ACTIVE
version: 5
verify_jwt: true
```

The function code uses:

```ts
redirectTo = `${FEEDX_SITE_URL}/setup-password`
```

For setup emails:

- New auth user: `admin.auth.admin.inviteUserByEmail(email, { redirectTo })`
- Existing auth user: `userClient.auth.resetPasswordForEmail(email, { redirectTo })`
- SMTP-like failures are surfaced as `SMTP_NOT_CONFIGURED` or `AUTH_EMAIL_FAILED`
- Manual setup link mode uses `admin.auth.admin.generateLink(...)`

### Edge Function Secrets

Secret names present:

```text
FEEDX_SITE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
```

Supabase CLI only returns secret digests, not values, so this audit could not confirm whether `FEEDX_SITE_URL` equals the final production Vercel domain.

### Forgot Password Probe

Direct production Auth request:

```text
POST https://oyfobxdoyfuzsodogpgs.supabase.co/auth/v1/recover
email: isaacyap28@gmail.com
redirect_to: https://fnb-system.vercel.app/setup-password
```

Result:

```json
{
  "flow": "forgot_password_recover",
  "status": 200,
  "ok": true,
  "body": {}
}
```

Interpretation:

- Supabase Auth accepted the request.
- The redirect URL was not rejected at request time.
- This does not prove mailbox delivery.

### Auth Audit Logs

Query:

```sql
select id, payload, created_at
from auth.audit_log_entries
order by created_at desc
limit 20;
```

Result: no rows.

Interpretation:

- Production Auth audit log table did not provide useful email-delivery evidence.
- Provider-level SMTP delivery/bounce logs remain required.

## Failure Source Assessment

| Candidate | Assessment | Evidence |
|---|---:|---|
| A. SMTP not configured | Possible | CLI cannot confirm SMTP; reported email did not arrive |
| B. SMTP credentials invalid | Possible | Requires Dashboard/provider logs |
| C. Sender domain not verified | Possible | Requires Dashboard/provider logs |
| D. Redirect URL mismatch | Less likely | Auth recover request with production `/setup-password` returned HTTP 200 |
| E. Auth email disabled | Possible | Dashboard-only setting; API acceptance does not prove delivery |
| F. Application-side error | Less likely | Direct Auth request succeeded; Edge Function code has explicit SMTP error handling |

## Exact Failure Reason

Exact failure reason is **not determinable from the repository, Postgres, or Supabase CLI surfaces available in this environment**.

The strongest current conclusion is:

> Production Auth email request is accepted by Supabase, but actual email delivery is blocked or failing downstream in Supabase Auth email configuration / SMTP provider / sender deliverability.

This keeps the release gate **BLOCKED** until the Dashboard/provider checks below are completed.

## Required Dashboard Checks

In Production Supabase Dashboard for project `oyfobxdoyfuzsodogpgs`:

1. Authentication -> Email
   - Confirm email provider is enabled.
   - Confirm invite email and recovery email flows are enabled.

2. Authentication -> SMTP Settings
   - Confirm whether custom SMTP is enabled.
   - If enabled, verify host, port, username, sender email, and sender name.
   - Send a provider-level test email if available.
   - Check SMTP provider logs for rejection, bounce, or authentication errors.

3. Authentication -> Email Templates
   - Confirm Invite template is enabled and contains a valid confirmation/setup link variable.
   - Confirm Recovery template is enabled and contains a valid reset/setup link variable.

4. Authentication -> URL Configuration
   - Site URL should be the production Vercel domain.
   - Redirect URLs should include:
     - `https://fnb-system.vercel.app/*`
     - `https://fnb-system.vercel.app/setup-password`
     - `https://fnb-system.vercel.app/login`
   - Replace `fnb-system.vercel.app` if the final production custom domain differs.

5. Mailbox/provider checks
   - Check spam/junk/quarantine.
   - Check sender reputation/domain verification.
   - Check SPF/DKIM/DMARC if using a custom sender domain.

## Setup Email Flow Status

Status: **Blocked pending SMTP/dashboard verification**

Known:

- Edge Function is deployed.
- Required secret names exist.
- Code sends setup links to `/setup-password`.
- Email setup flow should show a manual setup-link fallback when Supabase returns a detectable SMTP/email-sending error.

Unknown:

- Whether custom SMTP is configured.
- Whether SMTP credentials are valid.
- Whether sender domain is verified.
- Whether invite/recovery templates are enabled and valid.
- Whether Supabase default email sender is being used and rate-limited/suppressed.

## Forgot Password Flow Status

Status: **API accepted, mailbox delivery not verified**

Known:

- Auth recover API returned HTTP 200.
- Redirect URL was accepted.

Unknown:

- Whether email was actually delivered.
- Whether provider logs show a bounce/suppression.

## Recommendation

Decision: **BLOCKED**

Do not mark production SMTP ready until:

1. Dashboard confirms email provider/SMTP/template configuration.
2. A setup email arrives in the target mailbox.
3. A forgot-password email arrives in the target mailbox.
4. Both links open `/setup-password` on the production domain.
5. Password setup/reset completes without Access Error.

## No Fixes Applied

This was an audit only.

No SMTP settings, email templates, redirect URLs, Edge Function code, database rows, or Vercel environment variables were changed.
