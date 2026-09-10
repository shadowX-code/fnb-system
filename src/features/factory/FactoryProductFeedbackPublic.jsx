import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Send, Star } from "lucide-react";
import { factoryService } from "../../services/factoryService.js";
import "./FactoryProductFeedbackPublic.css";

const copy = {
  en: { back: "Back", continue: "Continue", selected: "selected", submit: "Submit feedback", skip: "Skip", optional: "Optional", name: "Name", mobile: "Mobile number", consent: "By providing your details, you agree that we may contact you about this product.", contactPrompt: "Interested in this product? Leave your details and we'll keep you updated.", invalidMobile: "Enter a valid Malaysian mobile number.", question: "Question", thankYou: "Thank you", unavailable: "Feedback unavailable", unavailableBody: "This feedback link is unavailable.", preparing: "Preparing feedback...", selectAll: "Select one or more", placeholder: "Share your thoughts" },
  zh: { back: "返回", continue: "继续", selected: "已选择", submit: "提交反馈", skip: "跳过", optional: "可选", name: "姓名", mobile: "手机号码", consent: "提供您的资料即表示您同意我们就此产品与您联系。", contactPrompt: "对这款产品感兴趣？留下您的资料，我们会为您提供最新消息。", invalidMobile: "请输入有效的马来西亚手机号码。", question: "问题", thankYou: "谢谢您的反馈", unavailable: "反馈不可用", unavailableBody: "此反馈链接不可用。", preparing: "正在准备反馈...", selectAll: "请选择一项或多项", placeholder: "分享您的想法" },
  ms: { back: "Kembali", continue: "Teruskan", selected: "dipilih", submit: "Hantar maklum balas", skip: "Langkau", optional: "Pilihan", name: "Nama", mobile: "Nombor telefon", consent: "Dengan memberikan butiran anda, anda bersetuju bahawa kami boleh menghubungi anda tentang produk ini.", contactPrompt: "Berminat dengan produk ini? Tinggalkan butiran anda dan kami akan maklumkan perkembangan terkini.", invalidMobile: "Masukkan nombor mudah alih Malaysia yang sah.", question: "Soalan", thankYou: "Terima kasih", unavailable: "Maklum balas tidak tersedia", unavailableBody: "Pautan maklum balas ini tidak tersedia.", preparing: "Menyediakan maklum balas...", selectAll: "Pilih satu atau lebih", placeholder: "Kongsi pendapat anda" },
};

export function isPublicProductFeedbackRoute() { return /^\/feedback\/product\/[^/]+/.test(window.location.pathname) || /^#feedback\/product\//.test(window.location.hash); }
function tokenFromLocation() { const path = window.location.pathname.match(/^\/feedback\/product\/([^/]+)/); return path?.[1] || window.location.hash.match(/^#feedback\/product\/([^/]+)/)?.[1] || ""; }
function localized(value, language, fallback = "") { return value?.[language] || value?.en || fallback; }
function questionLabel(question, language) { return question?.[`label_${language}`] || question?.label_en || "Question"; }
function questionHelper(question, language) { return question?.[`helper_${language}`] || question?.helper_en || ""; }
function optionLabel(option, language) { return option?.[`label_${language}`] || option?.display_label || option?.label_en || option?.value || ""; }
function brandColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback; }
function selectionMinimum(question) { return Math.max(Number(question?.min_selections || (question?.required ? 1 : 0)), 0); }
export function normalizeMalaysiaMobile(value) {
  const raw = String(value || "").trim().replace(/[^0-9+]/g, "");
  if (!raw) return "";
  const normalized = raw.startsWith("0") ? `+60${raw.slice(1)}` : raw.startsWith("60") ? `+${raw}` : raw;
  return /^\+601\d{7,9}$/.test(normalized) ? normalized : null;
}

export default function FactoryProductFeedbackPublic() {
  const [entry, setEntry] = useState(null); const [error, setError] = useState(""); const [language, setLanguage] = useState("en"); const [step, setStep] = useState(0); const [answers, setAnswers] = useState({}); const [contactStep, setContactStep] = useState(false); const [contact, setContact] = useState({ name: "", mobile: "" }); const [contactError, setContactError] = useState(""); const [submitting, setSubmitting] = useState(false); const [complete, setComplete] = useState(false);
  const token = useMemo(tokenFromLocation, []);
  useEffect(() => {
    let current = true;
    factoryService.publicProductFeedbackEntry(token)
      .then((data) => {
        if (!current) return;
        if (!data?.available) setError("unavailable");
        else {
          setEntry(data);
          setLanguage(["en", "zh", "ms"].includes(data.campaign.default_language) ? data.campaign.default_language : "en");
        }
      })
      .catch(() => { if (current) setError("unavailable"); });
    return () => { current = false; };
  }, [token]);
  const campaign = entry?.campaign || {}; const questions = campaign.questions || []; const question = questions[step]; const value = answers[question?.key]; const text = copy[language]; const contactCollection = campaign.contact_collection || {}; const contactEnabled = contactCollection.enabled === true;
  const content = campaign.content || {}; const branding = campaign.branding || {}; const style = { "--feedback-primary": brandColor(branding.primary_color, "#168546"), "--feedback-accent": brandColor(branding.accent_color, "#0f6e3b") };
  const setValue = (next) => setAnswers((current) => ({ ...current, [question.key]: next }));
  const canContinue = !question?.required || (Array.isArray(value) ? value.length >= selectionMinimum(question) : String(value || "").trim());
  const next = () => { if (step < questions.length - 1) setStep((current) => current + 1); else if (contactEnabled) setContactStep(true); };
  const autoAdvance = (nextValue) => { setValue(nextValue); window.setTimeout(next, 180); };
  async function submit(nextContact = contact) {
    const normalizedMobile = normalizeMalaysiaMobile(nextContact.mobile);
    if (nextContact.mobile.trim() && !normalizedMobile) { setContactError(text.invalidMobile); return; }
    const sessionToken = localStorage.getItem("feedx.productFeedback.session") || crypto.randomUUID(); localStorage.setItem("feedx.productFeedback.session", sessionToken); setSubmitting(true);
    try { await factoryService.submitPublicProductFeedback({ token, answers, language, sessionToken, contact: { name: nextContact.name.trim(), mobile: normalizedMobile || "" } }); setComplete(true); } catch (err) { setError(err.message || "submit"); } finally { setSubmitting(false); }
  }
  const title = localized(content.title, language, campaign.name || "Product feedback"); const description = localized(content.description, language, campaign.event_label || "");
  if (error) return <PublicShell style={style}><section className="feedback-public-state"><h1>{text.unavailable}</h1><p>{error === "unavailable" ? text.unavailableBody : error}</p></section></PublicShell>;
  if (!entry) return <PublicShell style={style}><section className="feedback-public-state"><p>{copy.en.preparing}</p></section></PublicShell>;
  if (complete) return <PublicShell style={style}><section className="feedback-thank-you">{branding.logo_url ? <img className="feedback-brand-logo" src={branding.logo_url} alt="" /> : null}{branding.thank_you_image_url ? <img className="feedback-thank-image" src={branding.thank_you_image_url} alt="" /> : <div className="feedback-check"><Check /></div>}<h1>{localized(content.thank_you_title, language, text.thankYou)}</h1><p>{localized(content.thank_you_body, language, language === "zh" ? campaign.thank_you_zh : campaign.thank_you_en || "Your product feedback has been recorded.")}</p></section></PublicShell>;
  const isMulti = question?.type === "multi_choice"; const selectedCount = Array.isArray(value) ? value.length : 0;
  const continueLabel = isMulti ? `${text.continue} · ${selectedCount} ${text.selected}` : text.continue;
  if (contactStep) return <PublicShell style={style}><section className="feedback-form"><header className="feedback-form-header">{branding.logo_url ? <img className="feedback-header-logo" src={branding.logo_url} alt="" /> : <span className="feedback-header-name">{title}</span>}<LanguageSwitch language={language} onChange={setLanguage} /></header><article className="feedback-question feedback-contact-step"><span className="feedback-optional">{text.optional}</span><h1>{localized(contactCollection.prompt, language, text.contactPrompt)}</h1><label>{text.name}<input value={contact.name} onChange={(event) => setContact((current) => ({ ...current, name: event.target.value }))} /></label><label>{text.mobile}<input inputMode="tel" value={contact.mobile} placeholder="+60 12 345 6789" onChange={(event) => { setContactError(""); setContact((current) => ({ ...current, mobile: event.target.value })); }} /></label>{contactError ? <p className="feedback-contact-error" role="alert">{contactError}</p> : null}<p className="feedback-contact-consent">{text.consent}</p></article><footer className="feedback-actions"><button type="button" className="feedback-back" onClick={() => setContactStep(false)}><ArrowLeft size={17} /> {text.back}</button><div className="flex gap-2"><button type="button" className="feedback-back" disabled={submitting} onClick={() => submit({ name: "", mobile: "" })}>{text.skip}</button><button type="button" className="feedback-primary-action" disabled={submitting} onClick={() => submit()}><Send size={16} /> {submitting ? "…" : text.submit}</button></div></footer></section></PublicShell>;
  return <PublicShell style={style}><section className={`feedback-form ${step === 0 ? "feedback-form--first-question" : ""}`}><header className="feedback-form-header">{branding.logo_url ? <img className={`feedback-header-logo ${step === 0 ? "feedback-header-logo--context" : ""}`} src={branding.logo_url} alt="" /> : step > 0 ? <span className="feedback-header-name">{title}</span> : <span aria-hidden="true" />}<LanguageSwitch language={language} onChange={setLanguage} /></header>{step === 0 ? <>{branding.hero_url ? <img className="feedback-question-hero" src={branding.hero_url} alt="" /> : null}<section className="feedback-campaign-context"><h1>{title}</h1>{description ? <p>{description}</p> : null}</section></> : null}<div className="feedback-progress" aria-label={`${step + 1} / ${questions.length}`}><span>{text.question} {step + 1} / {questions.length}</span><div><i style={{ width: `${((step + 1) / questions.length) * 100}%` }} /></div></div><article className="feedback-question"><h1>{questionLabel(question, language)}</h1>{questionHelper(question, language) ? <p className="feedback-helper">{questionHelper(question, language)}</p> : null}<QuestionControl question={question} language={language} value={value} onChange={setValue} onAutoAdvance={autoAdvance} selectAllLabel={text.selectAll} selectedLabel={text.selected} placeholder={text.placeholder} /></article><footer className="feedback-actions"><button type="button" className="feedback-back" disabled={!step} onClick={() => setStep((current) => current - 1)}><ArrowLeft size={17} /> {text.back}</button>{step === questions.length - 1 ? <button type="button" className="feedback-primary-action" disabled={!canContinue || submitting} onClick={contactEnabled ? next : () => submit({ name: "", mobile: "" })}>{contactEnabled ? text.continue : <><Send size={16} /> {submitting ? "…" : text.submit}</>}</button> : <button type="button" className="feedback-primary-action" disabled={!canContinue} onClick={next}>{continueLabel}<ChevronRight size={17} /></button>}</footer></section></PublicShell>;
}

function PublicShell({ children, style }) { return <main className="product-feedback-public" style={style}>{children}</main>; }
function LanguageSwitch({ language, onChange }) { return <div className="feedback-language-switch" aria-label="Language">{["en", "zh", "ms"].map((item) => <button type="button" className={language === item ? "active" : ""} key={item} onClick={() => onChange(item)}>{item === "zh" ? "中文" : item === "ms" ? "BM" : "EN"}</button>)}</div>; }
function QuestionControl({ question, language, value, onChange, onAutoAdvance, selectAllLabel, selectedLabel, placeholder }) {
  const options = question.options || [];
  if (question.type === "short_text") return <textarea value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />;
  if (question.type === "rating") return <div className="feedback-rating" role="radiogroup">{options.map((option) => <button key={option.value} type="button" aria-label={`${option.value} stars`} aria-pressed={value === option.value} className={value === option.value ? "selected" : ""} onClick={() => onAutoAdvance(option.value)}><Star size={23} fill={value === option.value ? "currentColor" : "none"} /><span>{option.value}</span></button>)}</div>;
  if (question.type === "image_choice") return <div className="feedback-image-options">{options.map((option) => <button key={option.value} type="button" className={value === option.value ? "selected" : ""} onClick={() => onChange(option.value)}>{option.image_url ? <img src={option.image_url} alt="" /> : <span className="feedback-image-placeholder" />}{optionLabel(option, language)}<Check size={17} /></button>)}</div>;
  if (question.type === "multi_choice") { const selectedCount = Array.isArray(value) ? value.length : 0; return <><p className="feedback-select-all">{selectAllLabel}{selectedCount ? ` · ${selectedCount} ${selectedLabel}` : ""}</p><div className="feedback-multi-options">{options.map((option) => { const selected = Array.isArray(value) && value.includes(option.value); return <button key={option.value} type="button" role="checkbox" aria-checked={selected} className={selected ? "selected" : ""} onClick={() => onChange(selected ? value.filter((item) => item !== option.value) : [...(value || []), option.value])}><span className="feedback-multi-checkbox" aria-hidden="true"><Check size={15} /></span><span>{optionLabel(option, language)}</span></button>; })}</div></>; }
  return <div className={question.type === "price_choice" ? "feedback-price-options" : "feedback-choice-options"}>{options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} className={value === option.value ? "selected" : ""} onClick={() => onAutoAdvance(option.value)}><span>{optionLabel(option, language)}</span><Check size={18} /></button>)}</div>;
}
