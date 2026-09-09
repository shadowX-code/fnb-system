import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Globe2, Send } from "lucide-react";
import { factoryService } from "../../services/factoryService.js";
import "./FactoryProductFeedbackPublic.css";

export function isPublicProductFeedbackRoute() {
  return /^\/feedback\/product\/[^/]+/.test(window.location.pathname) || /^#feedback\/product\//.test(window.location.hash);
}

function tokenFromLocation() {
  const path = window.location.pathname.match(/^\/feedback\/product\/([^/]+)/);
  return path?.[1] || window.location.hash.match(/^#feedback\/product\/([^/]+)/)?.[1] || "";
}

function label(question, language) { return question?.[language === "zh" ? "label_zh" : "label_en"] || question?.label_en || "Question"; }

export default function FactoryProductFeedbackPublic() {
  const [entry, setEntry] = useState(null); const [error, setError] = useState(""); const [language, setLanguage] = useState("en"); const [step, setStep] = useState(0); const [answers, setAnswers] = useState({}); const [submitting, setSubmitting] = useState(false); const [complete, setComplete] = useState(false);
  const token = useMemo(tokenFromLocation, []);
  useEffect(() => { factoryService.publicProductFeedbackEntry(token).then((data) => { if (!data?.available) setError("This feedback link is unavailable."); else { setEntry(data); setLanguage(data.campaign.default_language || "en"); } }).catch(() => setError("This feedback link is unavailable.")); }, [token]);
  const questions = entry?.campaign?.questions || []; const question = questions[step]; const value = answers[question?.key];
  const setValue = (next) => setAnswers((current) => ({ ...current, [question.key]: next }));
  const canContinue = !question?.required || (Array.isArray(value) ? value.length : String(value || "").trim());
  async function submit() { const sessionToken = localStorage.getItem("feedx.productFeedback.session") || crypto.randomUUID(); localStorage.setItem("feedx.productFeedback.session", sessionToken); setSubmitting(true); try { await factoryService.submitPublicProductFeedback({ token, answers, language, sessionToken }); setComplete(true); } catch (err) { setError(err.message || "We could not submit your feedback."); } finally { setSubmitting(false); } }
  if (error) return <main className="product-feedback-public"><section className="feedback-panel"><h1>Feedback unavailable</h1><p>{error}</p></section></main>;
  if (!entry) return <main className="product-feedback-public"><section className="feedback-panel"><p>Preparing feedback…</p></section></main>;
  if (complete) return <main className="product-feedback-public"><section className="feedback-panel feedback-thanks"><div className="feedback-check"><Check /></div><h1>{language === "zh" ? "谢谢您的反馈" : "Thank you"}</h1><p>{language === "zh" ? entry.campaign.thank_you_zh : entry.campaign.thank_you_en || "Your product feedback has been recorded."}</p></section></main>;
  return <main className="product-feedback-public"><section className="feedback-panel"><header className="feedback-top"><div><span>{entry.variant?.name || entry.campaign.event_label || "Product tasting"}</span><h1>{entry.campaign.name}</h1></div><button type="button" className="feedback-language" onClick={() => setLanguage(language === "en" ? "zh" : "en")}><Globe2 size={15} /> {language === "en" ? "中文" : "EN"}</button></header><div className="feedback-progress"><span>{step + 1} / {questions.length}</span><div><i style={{ width: `${((step + 1) / questions.length) * 100}%` }} /></div></div><article className="feedback-question"><p className="feedback-kicker">{language === "zh" ? "产品反馈" : "Product feedback"}</p><h2>{label(question, language)}</h2>{["single_choice", "price_choice", "image_choice", "rating"].includes(question.type) ? <div className={question.type === "rating" ? "feedback-rating" : "feedback-options"}>{question.options?.map((option) => <button key={option.value} type="button" className={value === option.value ? "selected" : ""} onClick={() => setValue(option.value)}>{question.type === "rating" ? option.value : option[language === "zh" ? "label_zh" : "label_en"] || option.value}</button>)}</div> : question.type === "multi_choice" ? <div className="feedback-options">{question.options?.map((option) => { const selected = Array.isArray(value) && value.includes(option.value); return <button key={option.value} type="button" className={selected ? "selected" : ""} onClick={() => setValue(selected ? value.filter((item) => item !== option.value) : [...(value || []), option.value])}>{option[language === "zh" ? "label_zh" : "label_en"] || option.value}</button>; })}</div> : <textarea value={value || ""} onChange={(event) => setValue(event.target.value)} placeholder={language === "zh" ? "请填写您的意见" : "Share your thoughts"} />}</article><footer className="feedback-actions"><button type="button" className="feedback-back" disabled={!step} onClick={() => setStep((current) => current - 1)}><ArrowLeft size={16} /> {language === "zh" ? "返回" : "Back"}</button>{step === questions.length - 1 ? <button type="button" className="feedback-submit" disabled={!canContinue || submitting} onClick={submit}><Send size={16} /> {submitting ? "…" : language === "zh" ? "提交" : "Submit feedback"}</button> : <button type="button" className="feedback-submit" disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>{language === "zh" ? "继续" : "Continue"}<ChevronRight size={16} /></button>}</footer></section></main>;
}
