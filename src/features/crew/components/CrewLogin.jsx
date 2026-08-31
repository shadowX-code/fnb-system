import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronDown, Delete, ShieldCheck } from "lucide-react";
import { crewService } from "../../../services/crewService.js";

export default function CrewLogin({ onSignedIn }) {
  const { t } = useTranslation();
  const [step, setStep] = useState("mobile");
  const [countryCode, setCountryCode] = useState("+60");
  const [mobile, setMobile] = useState("");
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submitLogin = async (code) => {
    if (loading || code.length !== 4) return;
    setLoading(true);
    setError("");
    try {
      const normalizedMobile = mobile.trim().startsWith("+") ? mobile.trim() : `${countryCode}${mobile.replace(/^0+/, "")}`;
      const session = await crewService.signIn(normalizedMobile, code);
      onSignedIn(session);
    } catch (cause) {
      setError(cause.message || t("auth.unable"));
      setPasscode("");
    } finally {
      setLoading(false);
    }
  };

  const addDigit = (digit) => {
    if (loading) return;
    const next = `${passcode}${digit}`.slice(0, 4);
    setPasscode(next);
    if (next.length === 4) submitLogin(next);
  };

  const normalizedDigits = mobile.replace(/\D/g, "");
  const mobileNumberValid = normalizedDigits.length >= 8 && normalizedDigits.length <= 12;
  const mobileSuffix = normalizedDigits.slice(-4).padStart(4, "•");
  const maskedMobile = `${countryCode} •••• ${mobileSuffix}`;

  const brand = <div className="crew-auth-brand" aria-label="FeedX">
    <span className="crew-auth-logo-mark"><img src="/design-homepage/logo.png" alt="" draggable="false" /></span>
    <strong>FeedX</strong>
  </div>;

  if (step === "passcode") return <main className="crew-v2-shell"><section className="crew-v2-login is-passcode">
    <header className="crew-auth-passcode-header">
      <button className="crew-v2-login-back" type="button" onClick={() => { setStep("mobile"); setPasscode(""); setError(""); }} aria-label={t("common.back")}><ArrowLeft size={21} /></button>
      {brand}
    </header>
    <div className="crew-v2-login-copy"><h1>{t("auth.welcomeBack")}</h1><p>{t("auth.enterPasscode")}</p><strong className="crew-auth-masked-mobile">{maskedMobile}</strong></div>
    <div className="crew-v2-passcode-dots" aria-label={t("auth.digitsEntered", { count: passcode.length })}>{[0, 1, 2, 3].map((index) => <span key={index} className={index < passcode.length ? "filled" : ""} />)}</div>
    <div className="crew-auth-feedback" aria-live="polite">
      {error && <div className="crew-v2-error" role="alert">{error}</div>}
      {loading && <div className="crew-v2-login-loading"><span className="crew-v2-spinner" /> {t("auth.signingIn")}</div>}
    </div>
    <div className="crew-v2-keypad" aria-label={t("auth.enterPasscode")}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => <button type="button" key={digit} disabled={loading} onClick={() => addDigit(String(digit))}>{digit}</button>)}<span aria-hidden="true" /><button type="button" disabled={loading} onClick={() => addDigit("0")}>0</button><button type="button" disabled={loading || !passcode.length} aria-label={t("auth.backspace")} onClick={() => setPasscode((current) => current.slice(0, -1))}><Delete size={21} /></button></div>
    <p className="crew-auth-security"><ShieldCheck size={17} /> {t("auth.secure")}</p>
  </section></main>;

  return <main className="crew-v2-shell"><section className="crew-v2-login">
    {brand}
    <div className="crew-v2-login-copy"><h1>{t("auth.welcomeTo")}<br />FeedX <span>{t("auth.crew")}</span></h1><p className="crew-auth-lead">{t("auth.workday")}</p><p>{t("auth.signInPrompt")}</p></div>
    <form onSubmit={(event) => { event.preventDefault(); if (!mobileNumberValid) { setError(t("auth.invalidMobile")); return; } setError(""); setStep("passcode"); }}>
      <label>{t("auth.mobile")}</label>
      <div className="crew-ui-field crew-auth-mobile-field"><span className="crew-auth-country"><select aria-label={t("auth.countryCode")} value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="+60">+60</option><option value="+65">+65</option></select><ChevronDown size={17} aria-hidden="true" /></span><input aria-label={t("auth.mobile")} aria-invalid={Boolean(error)} inputMode="tel" autoComplete="tel" value={mobile} onChange={(event) => { setMobile(event.target.value.replace(/[^\d\s-]/g, "")); if (error) setError(""); }} placeholder="12 345 6789" required /></div>
      {error && <div className="crew-v2-error crew-auth-mobile-error" role="alert">{error}</div>}
      <button className="crew-mobile-primary" type="submit">{t("common.continue")}</button>
    </form>
  </section></main>;
}
