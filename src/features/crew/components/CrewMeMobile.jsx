import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Bell, BriefcaseBusiness, Camera, Check, ChevronRight, Clock3, Eye, EyeOff, FileText, HelpCircle, Languages, LoaderCircle, LockKeyhole, LogOut, MapPin, Plane, Settings, ShieldCheck, UserRound } from "lucide-react";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import { CrewActionRow, CrewMobilePageHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { SUPPORTED_CREW_LANGUAGES } from "../../../i18n/index.js";
import { formatCrewDate } from "../utils/crewI18n.js";
import { formatEmploymentType } from "../utils/crewMobile.js";
import crewMeProfileCredentialAsset from "../assets/crew-me-profile-credential-approved.webp";

function CrewProfileAvatar({ name, photoUrl, onChoose, uploading, t }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const initial = name?.trim().slice(0, 1) || "?";
  return <button type="button" className={`crew-me-profile-avatar${photoUrl && !failed ? " has-image" : ""}`} onClick={onChoose} disabled={uploading} aria-label={t("me.profilePhotoAction")}>
    {photoUrl && !failed && <img src={photoUrl} alt="" onError={() => setFailed(true)} />}
    <span className="crew-me-profile-avatar-initial">{initial}</span>
    <span className="crew-me-profile-avatar-edit" aria-hidden="true">{uploading ? <LoaderCircle size={14} className="crew-me-profile-avatar-spinner" /> : <Camera size={14} />}</span>
  </button>;
}

function ProfileInformation({ profile, employee, context, firstName, t, onBack, onChoosePhoto, uploadingPhoto, photoError }) {
  const date = (value) => value ? formatCrewDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }) : t("me.notProvided");
  const field = (label, value) => <div><dt>{label}</dt><dd>{value || t("me.notProvided")}</dd></div>;
  const name = profile.full_name || employee.full_name || firstName;
  const position = profile.position || employee.position || t("home.crewMember");
  const outlet = profile.outlet_name || context?.outlet_name || employee.workplace || t("me.notAssigned");
  const employmentType = profile.employment_type || employee.employment_type || "";
  return <><CrewMobileDetailHeader title={t("me.profile")} onBack={onBack} /><article className="crew-me-profile-detail">
    <header className="crew-me-profile-summary"><CrewProfileAvatar name={name} photoUrl={profile.profile_photo_url} onChoose={onChoosePhoto} uploading={uploadingPhoto} t={t} /><span className="crew-me-profile-identity"><h2>{name}</h2><p className="crew-me-profile-position">{position}</p><small className="crew-me-profile-outlet"><MapPin size={14} />{outlet}</small>{employmentType && <CrewStatusBadge tone="mint">{formatEmploymentType(employmentType)}</CrewStatusBadge>}</span></header>
    {photoError && <p className="crew-v2-error" role="alert">{photoError}</p>}
    <section><h2>{t("me.personal")}</h2><dl>{field(t("me.nickname"), profile.nickname || employee.nickname)}{field(t("me.birthday"), date(profile.birthday))}{field(t("me.contact"), profile.contact || employee.contact)}</dl></section>
    <section><h2>{t("me.employment")}</h2><dl>{field(t("me.joinedDate"), date(profile.joined_date))}</dl></section>
  </article></>;
}


export default function CrewMeMobile({ session, context, profile, attendance, leave, onChangePasscode, onUpdateProfilePhoto, passcodeSuccess, navigate, onLogout }) {
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
  const [showPasscodes, setShowPasscodes] = useState({ current: false, next: false, confirm: false });
  const [attempted, setAttempted] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef(null);
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
    setAttempted(true);
    if (!/^\d{4}$/.test(currentPasscode) || !/^\d{4}$/.test(newPasscode) || newPasscode !== confirmPasscode) return;
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

  async function updatePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUpdateProfilePhoto) return;
    setPhotoError("");
    setUploadingPhoto(true);
    try {
      await onUpdateProfilePhoto(file);
    } catch (cause) {
      if (active.current) setPhotoError(cause.message || t("me.profilePhotoFailed"));
    } finally {
      if (active.current) setUploadingPhoto(false);
    }
  }
  const passcodeInvalid = !/^\d{4}$/.test(currentPasscode) || !/^\d{4}$/.test(newPasscode) || newPasscode !== confirmPasscode;
  const passcodeField = (key, label, value, setValue, autoComplete, inlineError) => <label className="crew-me-passcode-field">{label}<span><input type={showPasscodes[key] ? "text" : "password"} inputMode="numeric" autoComplete={autoComplete} maxLength="4" value={value} onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))} aria-invalid={Boolean(inlineError)} /><button type="button" onClick={() => setShowPasscodes((previous) => ({ ...previous, [key]: !previous[key] }))} aria-label={showPasscodes[key] ? t("me.hidePasscode") : t("me.showPasscode")}>{showPasscodes[key] ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>{inlineError && <small className="crew-me-inline-error">{inlineError}</small>}</label>;

  return <section className="crew-v2-me">
      {meView === "settings" ? <><CrewMobileDetailHeader title={t("me.settings")} onBack={() => setMeView("main")} /><section className="crew-me-settings crew-ui-functional-surface"><CrewActionRow icon={Bell} title={t("me.notifications")} /><CrewActionRow icon={Languages} title={t("me.language")} subtitle={t(`languages.${i18n.resolvedLanguage || i18n.language}`)} ariaLabel={t("me.language")} onClick={() => setLanguageOpen(true)} /><CrewActionRow icon={ShieldCheck} title={t("me.privacy")} /><CrewActionRow icon={FileText} title={t("me.terms")} /><CrewActionRow icon={HelpCircle} title={t("me.about")} /></section></> : meView === "profile" ? <ProfileInformation profile={profile || employee} employee={employee} context={context} firstName={firstName} t={t} onBack={() => setMeView("main")} onChoosePhoto={() => photoInput.current?.click()} uploadingPhoto={uploadingPhoto} photoError={photoError} /> : meView === "passcode" ? <section className="crew-me-passcode-page"><CrewMobileDetailHeader title={t("me.changePasscode")} onBack={() => setMeView("main")} /><form className="crew-v2-passcode-form" onSubmit={changePasscode}><p>{t("me.passcodeHelp")}</p>{passcodeField("current", t("me.currentPasscode"), currentPasscode, setCurrentPasscode, "current-password", attempted && !/^\d{4}$/.test(currentPasscode) ? t("me.enterPasscodes") : "")}{passcodeField("next", t("me.newPasscode"), newPasscode, setNewPasscode, "new-password", attempted && !/^\d{4}$/.test(newPasscode) ? t("me.enterPasscodes") : "")}{passcodeField("confirm", t("me.confirmNewPasscode"), confirmPasscode, setConfirmPasscode, "new-password", confirmPasscode && newPasscode !== confirmPasscode ? t("me.passcodeMismatch") : "")}{error && <div className="crew-v2-error" role="alert">{error}</div>}<button className="crew-mobile-primary" disabled={loading || passcodeInvalid}>{loading ? t("common.saving") : t("me.savePasscode")}</button></form></section> : <>
        <CrewMobilePageHeader title={t("me.title")} />{passcodeSuccess && <p className="crew-me-success" role="status"><Check size={16} /> {t("me.passcodeSaved")}</p>}
        <section className="crew-me-profile-hero">
          <img className="crew-me-profile-credential-art" src={crewMeProfileCredentialAsset} alt="" aria-hidden="true" />
          <CrewProfileAvatar name={employee.full_name || firstName} photoUrl={profile?.profile_photo_url} onChoose={() => photoInput.current?.click()} uploading={uploadingPhoto} t={t} />
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
      <input ref={photoInput} className="crew-me-profile-photo-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={updatePhoto} tabIndex="-1" aria-hidden="true" />
      {languageOpen && <CrewBottomSheet title={t("me.languageTitle")} description={t("me.languageHint")} onClose={() => setLanguageOpen(false)} className="crew-language-modal"><div className="crew-ui-segmented crew-language-segmented" role="group" aria-label={t("me.language")}>{SUPPORTED_CREW_LANGUAGES.map((language) => <button type="button" key={language} className={(i18n.resolvedLanguage || i18n.language) === language ? "is-active" : ""} aria-pressed={(i18n.resolvedLanguage || i18n.language) === language} onClick={() => { i18n.changeLanguage(language); }}>{t(`languages.${language}`)}</button>)}</div></CrewBottomSheet>}
      {logoutConfirmOpen && <CrewMobileModal title={t("me.logoutTitle")} description={t("me.logoutBody")} onClose={() => setLogoutConfirmOpen(false)} footer={<><button type="button" className="crew-mobile-ghost" onClick={() => setLogoutConfirmOpen(false)}>{t("common.cancel")}</button><button type="button" className="crew-mobile-destructive" onClick={onLogout}>{t("me.logout")}</button></>} />}
    </section>;
}
