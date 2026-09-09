import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Send, Star } from "lucide-react";
import { factoryService } from "../../services/factoryService.js";
import "./FactoryProductFeedbackPublic.css";

const copy = {
  en: { back: "Back", continue: "Continue", selected: "selected", submit: "Submit feedback", question: "Question", thankYou: "Thank you", unavailable: "Feedback unavailable", unavailableBody: "This feedback link is unavailable.", preparing: "Preparing feedback...", selectAll: "Select one or more", placeholder: "Share your thoughts" },
  zh: { back: "返回", continue: "继续", selected: "已选择", submit: "提交反馈", question: "问题", thankYou: "谢谢您的反馈", unavailable: "反馈不可用", unavailableBody: "此反馈链接不可用。", preparing: "正在准备反馈...", selectAll: "请选择一项或多项", placeholder: "分享您的想法" },
  ms: { back: "Kembali", continue: "Teruskan", selected: "dipilih", submit: "Hantar maklum balas", question: "Soalan", thankYou: "Terima kasih", unavailable: "Maklum balas tidak tersedia", unavailableBody: "Pautan maklum balas ini tidak tersedia.", preparing: "Menyediakan maklum balas...", selectAll: "Pilih satu atau lebih", placeholder: "Kongsi pendapat anda" },
};

export function isPublicProductFeedbackRoute() { return /^\/feedback\/product\/[^/]+/.test(window.location.pathname) || /^#feedback\/product\//.test(window.location.hash); }
function tokenFromLocation() { const path = window.location.pathname.match(/^\/feedback\/product\/([^/]+)/); return path?.[1] || window.location.hash.match(/^#feedback\/product\/([^/]+)/)?.[1] || ""; }
function localized(value, language, fallback = "") { return value?.[language] || value?.en || fallback; }
function questionLabel(question, language) { return question?.[`label_${language}`] || question?.label_en || "Question"; }
function questionHelper(question, language) { return question?.[`helper_${language}`] || question?.helper_en || ""; }
function optionLabel(option, language) { return option?.[`label_${language}`] || option?.display_label || option?.label_en || option?.value || ""; }
function brandColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback; }
function selectionMinimum(question) { return Math.max(Number(question?.min_selections || (question?.required ? 1 : 0)), 0); }

export default function FactoryProductFeedbackPublic() {
  const [entry, setEntry] = useState(null); const [error, setError] = useState(""); const [language, setLanguage] = useState("en"); const [step, setStep] = useState(0); const [answers, setAnswers] = useState({}); const [submitting, setSubmitting] = useState(false); const [complete, setComplete] = useState(false);
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
  const campaign = entry?.campaign || {}; const questions = campaign.questions || []; const question = questions[step]; const value = answers[question?.key]; const text = copy[language];
  const content = campaign.content || {}; const branding = campaign.branding || {}; const style = { "--feedback-primary": brandColor(branding.primary_color, "#168546"), "--feedback-accent": brandColor(branding.accent_color, "#0f6e3b") };
  const setValue = (next) => setAnswers((current) => ({ ...current, [question.key]: next }));
  const canContinue = !question?.required || (Array.isArray(value) ? value.length >= selectionMinimum(question) : String(value || "").trim());
  const next = () => { if (step < questions.length - 1) setStep((current) => current + 1); };
  const autoAdvance = (nextValue) => { setValue(nextValue); if (step < questions.length - 1) window.setTimeout(next, 180); };
  async function submit() { const sessionToken = localStorage.getItem("feedx.productFeedback.session") || crypto.randomUUID(); localStorage.setItem("feedx.productFeedback.session", sessionToken); setSubmitting(true); try { await factoryService.submitPublicProductFeedback({ token, answers, language, sessionToken }); setComplete(true); } catch (err) { setError(err.message || "submit"); } finally { setSubmitting(false); } }
  const title = localized(content.title, language, campaign.name || "Product feedback"); const description = localized(content.description, language, campaign.event_label || "");
  if (error) return <PublicShell style={style}><section className="feedback-public-state"><h1>{text.unavailable}</h1><p>{error === "unavailable" ? text.unavailableBody : error}</p></section></PublicShell>;
  if (!entry) return <PublicShell style={style}><section className="feedback-public-state"><p>{copy.en.preparing}</p></section></PublicShell>;
  if (complete) return <PublicShell style={style}><section className="feedback-thank-you">{branding.logo_url ? <img className="feedback-brand-logo" src={branding.logo_url} alt="" /> : null}{branding.thank_you_image_url ? <img className="feedback-thank-image" src={branding.thank_you_image_url} alt="" /> : <div className="feedback-check"><Check /></div>}<h1>{localized(content.thank_you_title, language, text.thankYou)}</h1><p>{localized(content.thank_you_body, language, language === "zh" ? campaign.thank_you_zh : campaign.thank_you_en || "Your product feedback has been recorded.")}</p></section></PublicShell>;
  const isMulti = question?.type === "multi_choice"; const selectedCount = Array.isArray(value) ? value.length : 0;
  const continueLabel = isMulti ? `${text.continue} · ${selectedCount} ${text.selected}` : text.continue;
  return <PublicShell style={style}><section className={`feedback-form ${step === 0 ? "feedback-form--first-question" : ""}`}><header className="feedback-form-header">{branding.logo_url ? <img className={`feedback-header-logo ${step === 0 ? "feedback-header-logo--context" : ""}`} src={branding.logo_url} alt="" /> : step > 0 ? <span className="feedback-header-name">{title}</span> : <span aria-hidden="true" />}<LanguageSwitch language={language} onChange={setLanguage} /></header>{step === 0 ? <>{branding.hero_url ? <img className="feedback-question-hero" src={branding.hero_url} alt="" /> : null}<section className="feedback-campaign-context"><h1>{title}</h1>{description ? <p>{description}</p> : null}</section></> : null}<div className="feedback-progress" aria-label={`${step + 1} / ${questions.length}`}><span>{text.question} {step + 1} / {questions.length}</span><div><i style={{ width: `${((step + 1) / questions.length) * 100}%` }} /></div></div><article className="feedback-question"><h1>{questionLabel(question, language)}</h1>{questionHelper(question, language) ? <p className="feedback-helper">{questionHelper(question, language)}</p> : null}<QuestionControl question={question} language={language} value={value} onChange={setValue} onAutoAdvance={autoAdvance} selectAllLabel={text.selectAll} selectedLabel={text.selected} placeholder={text.placeholder} /></article><footer className="feedback-actions"><button type="button" className="feedback-back" disabled={!step} onClick={() => setStep((current) => current - 1)}><ArrowLeft size={17} /> {text.back}</button>{step === questions.length - 1 ? <button type="button" className="feedback-primary-action" disabled={!canContinue || submitting} onClick={submit}><Send size={16} /> {submitting ? "…" : text.submit}</button> : <button type="button" className="feedback-primary-action" disabled={!canContinue} onClick={next}>{continueLabel}<ChevronRight size={17} /></button>}</footer></section></PublicShell>;
}

function PublicShell({ children, style }) { return <main className="product-feedback-public" style={style}>{children}</main>; }
function LanguageSwitch({ language, onChange }) { return <div className="feedback-language-switch" aria-label="Language">{["en", "zh", "ms"].map((item) => <button type="button" className={language === item ? "active" : ""} key={item} onClick={() => onChange(item)}>{item === "zh" ? "中文" : item.toUpperCase()}</button>)}</div>; }
function QuestionControl({ question, language, value, onChange, onAutoAdvance, selectAllLabel, selectedLabel, placeholder }) {
  const options = question.options || [];
  if (question.type === "short_text") return <textarea value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />;
  if (question.type === "rating") return <div className="feedback-rating" role="radiogroup">{options.map((option) => <button key={option.value} type="button" aria-label={`${option.value} stars`} aria-pressed={value === option.value} className={value === option.value ? "selected" : ""} onClick={() => onAutoAdvance(option.value)}><Star size={23} fill={value === option.value ? "currentColor" : "none"} /><span>{option.value}</span></button>)}</div>;
  if (question.type === "image_choice") return <div className="feedback-image-options">{options.map((option) => <button key={option.value} type="button" className={value === option.value ? "selected" : ""} onClick={() => onChange(option.value)}>{option.image_url ? <img src={option.image_url} alt="" /> : <span className="feedback-image-placeholder" />}{optionLabel(option, language)}<Check size={17} /></button>)}</div>;
  if (question.type === "multi_choice") { const selectedCount = Array.isArray(value) ? value.length : 0; return <><p className="feedback-select-all">{selectAllLabel}{selectedCount ? ` · ${selectedCount} ${selectedLabel}` : ""}</p><div className="feedback-multi-options">{options.map((option) => { const selected = Array.isArray(value) && value.includes(option.value); return <button key={option.value} type="button" role="checkbox" aria-checked={selected} className={selected ? "selected" : ""} onClick={() => onChange(selected ? value.filter((item) => item !== option.value) : [...(value || []), option.value])}><span className="feedback-multi-checkbox" aria-hidden="true"><Check size={15} /></span><span>{optionLabel(option, language)}</span></button>; })}</div></>; }
  return <div className={question.type === "price_choice" ? "feedback-price-options" : "feedback-choice-options"}>{options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} className={value === option.value ? "selected" : ""} onClick={() => onAutoAdvance(option.value)}><span>{optionLabel(option, language)}</span><Check size={18} /></button>)}</div>;
}
