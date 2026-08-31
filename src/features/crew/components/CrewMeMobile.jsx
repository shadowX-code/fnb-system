import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BriefcaseBusiness, Check, ChevronRight, Clock3, FileText, HelpCircle, Languages, LockKeyhole, LogOut, Plane, Settings, ShieldCheck, UserRound, Banknote } from "lucide-react";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import { CrewActionRow, CrewMobilePageHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { SUPPORTED_CREW_LANGUAGES } from "../../../i18n/index.js";
import { formatCrewDate } from "../utils/crewI18n.js";
import { formatEmploymentType } from "../utils/crewMobile.js";
import crewMeProfileCredentialAsset from "../assets/crew-me-profile-credential-approved.webp";

function ProfileInformation({ profile, employee, context, firstName, t, onBack }) {
  const date = (value) => value ? formatCrewDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const field = (label, value) => <div><dt>{label}</dt><dd>{value || "—"}</dd></div>;
  const name = profile.full_name || employee.full_name || firstName;
  const position = profile.position || employee.position || t("home.crewMember");
  const outlet = profile.outlet_name || context?.outlet_name || employee.workplace || t("me.notAssigned");
  const employmentStatus = profile.employment_status ? String(profile.employment_status).replace(/_/g, " ") : t("status.active");
  return <><CrewMobileDetailHeader title={t("me.profile")} onBack={onBack} /><article className="crew-me-profile-detail">
    <header className="crew-me-profile-summary"><span className="crew-v2-avatar is-large">{firstName.slice(0, 1)}</span><span><h2>{name}</h2><p>{position}</p><small>{outlet}</small><CrewStatusBadge tone="success">{employmentStatus}</CrewStatusBadge></span></header>
    <section><h2>{t("me.personal")}</h2><dl>{field(t("me.fullName"), name)}{field(t("me.nickname"), profile.nickname || employee.nickname)}{field(t("me.birthday"), date(profile.birthday))}{field(t("me.contact"), profile.contact || employee.contact)}</dl></section>
    <section><h2>{t("me.employment")}</h2><dl>{field(t("me.joinedDate"), date(profile.joined_date))}{field(t("me.position"), position)}{field(t("common.outlet"), outlet)}{field(t("me.employmentStatus"), <CrewStatusBadge tone="success">{employmentStatus}</CrewStatusBadge>)}</dl></section>
  </article></>;
}


export default function CrewMeMobile({ session, context, profile, attendance, leave, onChangePasscode, passcodeSuccess, navigate, onLogout }) {
  const { t, i18n } = useTranslation();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [meView, setMeView] = useState("main");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const employee = session.employee || {};
  const firstName = employee.nickname || employee.full_name?.split(" ")[0] || t("auth.crew");
  const employmentType = profile?.employment_type || employee.employment_type || "";
  const pendingLeaveCount = (leave?.requests || []).filter((item) => item.status === "pending").length;
  const currentMonthAttendance = attendance.filter((item) => {
    if (!item.clock_in_at) return false;
    const date = new Date(item.clock_in_at);
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  async function changePasscode(event) {
    event.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(currentPasscode) || !/^\d{4}$/.test(newPasscode) || newPasscode !== confirmPasscode) return setError(t("me.enterPasscodes"));
    setLoading(true);
    try {
      const changed = await onChangePasscode(currentPasscode, newPasscode);
      if (!changed || !active.current) return;
      setCurrentPasscode("");
      setNewPasscode("");
      setConfirmPasscode("");
      setMeView("main");
    } catch (cause) {
      if (!active.current) return;
      setError(cause.message || t("me.unablePasscode"));
    } finally {
      if (active.current) setLoading(false);
    }
  }

  return <section className="crew-v2-me">
      {meView === "settings" ? <><CrewMobileDetailHeader title={t("me.settings")} onBack={() => setMeView("main")} /><section className="crew-me-settings crew-ui-functional-surface"><CrewActionRow icon={Bell} title={t("me.notifications")} /><CrewActionRow icon={Languages} title={t("me.language")} subtitle={t(`languages.${i18n.resolvedLanguage || i18n.language}`)} ariaLabel={t("me.language")} onClick={() => setLanguageOpen(true)} /><CrewActionRow icon={ShieldCheck} title={t("me.privacy")} /><CrewActionRow icon={FileText} title={t("me.terms")} /><CrewActionRow icon={HelpCircle} title={t("me.about")} /></section></> : meView === "profile" ? <ProfileInformation profile={profile || employee} employee={employee} context={context} firstName={firstName} t={t} onBack={() => setMeView("main")} /> : meView === "passcode" ? <section className="crew-me-passcode-page"><CrewMobileDetailHeader title={t("me.changePasscode")} onBack={() => setMeView("main")} /><form className="crew-v2-passcode-form" onSubmit={changePasscode}><label>{t("me.currentPasscode")}<input inputMode="numeric" autoComplete="current-password" maxLength="4" value={currentPasscode} onChange={(event) => setCurrentPasscode(event.target.value.replace(/\D/g, ""))} /></label><label>{t("me.newPasscode")}<input inputMode="numeric" autoComplete="new-password" maxLength="4" value={newPasscode} onChange={(event) => setNewPasscode(event.target.value.replace(/\D/g, ""))} /></label><label>{t("me.confirmNewPasscode")}<input inputMode="numeric" autoComplete="new-password" maxLength="4" value={confirmPasscode} onChange={(event) => setConfirmPasscode(event.target.value.replace(/\D/g, ""))} /></label>{error && <div className="crew-v2-error">{error}</div>}<button className="crew-mobile-primary" disabled={loading}>{t("me.savePasscode")}</button></form></section> : <>
        <CrewMobilePageHeader title={t("me.title")} />{passcodeSuccess && <p className="crew-me-success" role="status"><Check size={16} /> {t("me.passcodeSaved")}</p>}
        <section className="crew-me-profile-hero">
          <img className="crew-me-profile-credential-art" src={crewMeProfileCredentialAsset} alt="" aria-hidden="true" />
          <span className="crew-v2-avatar is-large">{firstName.slice(0, 1)}</span>
          <span className="crew-me-profile-copy"><strong>{employee.full_name || firstName}</strong><small>{employee.position || t("home.crewMember")}</small><small className="crew-me-outlet"><BriefcaseBusiness size={14} />{context?.outlet_name || employee.workplace || t("home.yourOutlet")}</small>{employmentType && <CrewStatusBadge tone="mint">{formatEmploymentType(employmentType)}</CrewStatusBadge>}</span>
        </section>
        <section className="crew-me-section"><h2>{t("me.work")}</h2><div className="crew-me-list">
          <button type="button" onClick={() => navigate("attendance")}><span className="crew-me-row-icon crew-ui-icon-container"><Clock3 size={20} /></span><span><strong>{t("me.attendance")}</strong><small>{currentMonthAttendance.length ? t("me.shiftsThisMonth", { count: currentMonthAttendance.length }) : t("me.noActivity")}</small></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => navigate("leave")}><span className="crew-me-row-icon crew-ui-icon-container"><Plane size={20} /></span><span><span>{t("me.leave")}</span></span>{pendingLeaveCount > 0 && <em className="crew-me-pending">{t("me.pendingCount", { count: pendingLeaveCount })}</em>}<ChevronRight size={19} /></button>
          <button type="button" onClick={() => navigate("cash-checkout")}><span className="crew-me-row-icon crew-ui-icon-container"><Banknote size={20} /></span><span><strong>{t("cash.title")}</strong><small>{t("cash.meSubtitle")}</small></span><ChevronRight size={19} /></button>
          <div><span className="crew-me-row-icon crew-ui-icon-container"><FileText size={20} /></span><span><strong>{t("me.employmentDocuments")}</strong></span><ChevronRight size={19} /></div>
        </div></section>
        <section className="crew-me-section"><h2>{t("me.account")}</h2><div className="crew-me-list">
          <button type="button" onClick={() => setMeView("profile")}><span className="crew-me-row-icon crew-ui-icon-container"><UserRound size={20} /></span><span><strong>{t("me.profile")}</strong></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setMeView("passcode")}><span className="crew-me-row-icon crew-ui-icon-container"><LockKeyhole size={20} /></span><span><strong>{t("me.changePasscode")}</strong></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setMeView("settings")}><span className="crew-me-row-icon crew-ui-icon-container"><Settings size={20} /></span><span><strong>{t("me.settings")}</strong></span><ChevronRight size={19} /></button>
        </div></section>
        <button className="crew-v2-logout crew-mobile-destructive" type="button" onClick={() => setLogoutConfirmOpen(true)}><LogOut size={20} /> {t("me.logout")}</button>
      </>}
      {languageOpen && <CrewBottomSheet title={t("me.languageTitle")} description={t("me.languageHint")} onClose={() => setLanguageOpen(false)} className="crew-language-modal"><div className="crew-language-list">{SUPPORTED_CREW_LANGUAGES.map((language) => <button type="button" key={language} aria-pressed={(i18n.resolvedLanguage || i18n.language) === language} onClick={() => { i18n.changeLanguage(language); setLanguageOpen(false); }}><span>{t(`languages.${language}`)}</span>{(i18n.resolvedLanguage || i18n.language) === language && <Check size={18} />}</button>)}</div></CrewBottomSheet>}
      {logoutConfirmOpen && <CrewMobileModal title={t("me.logoutTitle")} description={t("me.logoutBody")} onClose={() => setLogoutConfirmOpen(false)} footer={<><button type="button" className="crew-mobile-ghost" onClick={() => setLogoutConfirmOpen(false)}>{t("common.cancel")}</button><button type="button" className="crew-mobile-destructive" onClick={onLogout}>{t("me.logout")}</button></>} />}
    </section>;
}
