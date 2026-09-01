import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  Coffee,
  Frown,
  Meh,
  Send,
  Smile,
  Store,
  UserRound,
  Utensils,
} from "lucide-react";
import { crewService } from "../../services/crewService";
import "./CrewGuestFeedback.css";

const scopes = [
  { value: "crew", icon: UserRound },
  { value: "food", icon: Utensils },
  { value: "outlet", icon: Store },
];

const experiences = [
  { value: "great", icon: Smile },
  { value: "okay", icon: Meh },
  { value: "needs_improvement", icon: Frown },
];

const tags = {
  crew: {
    great: ["Friendly", "Helpful", "Attentive", "Fast", "Knowledgeable"],
    okay: ["Friendly", "Helpful", "Attentive", "Fast", "Knowledgeable"],
    needs_improvement: ["Greeting", "Response Time", "Accuracy", "Cleanliness", "Product Knowledge"],
  },
  food: {
    great: ["Taste", "Portion", "Temperature", "Presentation", "Value", "Freshness"],
    okay: ["Taste", "Portion", "Temperature", "Presentation", "Value", "Freshness"],
    needs_improvement: ["Taste", "Portion", "Temperature", "Presentation", "Value", "Freshness"],
  },
  outlet: {
    great: ["Cleanliness", "Service Speed", "Atmosphere", "Ordering", "Waiting Time", "Comfort", "Overall Value"],
    okay: ["Cleanliness", "Service Speed", "Atmosphere", "Ordering", "Waiting Time", "Comfort", "Overall Value"],
    needs_improvement: ["Cleanliness", "Service Speed", "Atmosphere", "Ordering", "Waiting Time", "Comfort", "Overall Value"],
  },
};

const copy = {
  en: {
    loading: "Preparing your feedback card...",
    unavailableTitle: "This feedback link is unavailable",
    unavailableBody: "Please ask the team for a current feedback QR code.",
    chooseLanguage: "EN | 中文",
    scopeQuestion: "What would you like to share?",
    scopeHint: "A quick note helps this restaurant keep getting better.",
    scope: { crew: ["Crew", "Recognise a team member"], food: ["Food & Drinks", "Tell us about what you enjoyed"], outlet: ["Overall Visit", "Share your restaurant experience"] },
    crewQuestion: "Who would you like to mention?",
    crewHint: "Choose one team member, if someone stood out.",
    cannotFind: "Can't find them? Share an overall visit instead",
    experience: {
      crew: "How was your experience with {name}?",
      food: "How were your food and drinks?",
      outlet: "How was your visit?",
    },
    experienceChoices: { great: ["Great", "It made your visit better"], okay: ["Okay", "It was as expected"], needs_improvement: ["Could be better", "Help us improve next time"] },
    highlights: { great: "What stood out?", okay: "Anything stand out?", needs_improvement: "What could we improve?" },
    highlightsHint: "Choose any that apply.",
    continue: "Continue",
    commentQuestion: "Anything else you'd like to add?",
    commentHint: "Optional, but the team reads every note.",
    commentPlaceholder: "Share a little more...",
    skipAndSend: "Skip & send",
    send: "Send feedback",
    sending: "Sending...",
    submitError: "We couldn't send that just now. Please try again.",
    successTitle: "Thank you",
    successBody: "Your feedback has been shared with {outlet}.",
    successCrew: "Your recognition for {name} is on its way to the team.",
    tags: {
      Friendly: "Friendly", Helpful: "Helpful", Attentive: "Attentive", Fast: "Fast", Knowledgeable: "Knowledgeable",
      Greeting: "Greeting", "Response Time": "Response time", Accuracy: "Accuracy", Cleanliness: "Cleanliness", "Product Knowledge": "Product knowledge",
      Taste: "Taste", Portion: "Portion", Temperature: "Temperature", Presentation: "Presentation", Value: "Value", Freshness: "Freshness",
      "Service Speed": "Service speed", Atmosphere: "Atmosphere", Ordering: "Ordering", "Waiting Time": "Waiting time", Comfort: "Comfort", "Overall Value": "Overall value",
    },
  },
  zh: {
    loading: "正在准备您的反馈页面...",
    unavailableTitle: "此反馈链接暂不可用",
    unavailableBody: "请向餐厅团队索取最新的反馈二维码。",
    chooseLanguage: "EN | 中文",
    scopeQuestion: "您想分享哪一方面的体验？",
    scopeHint: "您的简短反馈能帮助餐厅持续进步。",
    scope: { crew: ["服务团队", "表扬一位表现出色的员工"], food: ["餐点与饮品", "分享您对餐点的感受"], outlet: ["整体到访体验", "分享您在餐厅的体验"] },
    crewQuestion: "您想提及哪位员工？",
    crewHint: "若有员工让您印象深刻，请选择一位。",
    cannotFind: "找不到他／她？分享整体到访体验",
    experience: {
      crew: "您与{name}的互动体验如何？",
      food: "您觉得餐点与饮品如何？",
      outlet: "您这次到访体验如何？",
    },
    experienceChoices: { great: ["很棒", "让这次到访更愉快"], okay: ["还不错", "符合预期"], needs_improvement: ["可以更好", "帮助我们下次做得更好"] },
    highlights: { great: "什么让您印象深刻？", okay: "有什么值得一提的吗？", needs_improvement: "我们可以如何改进？" },
    highlightsHint: "可选择所有适用项目。",
    continue: "继续",
    commentQuestion: "还想补充些什么吗？",
    commentHint: "选填，但团队会阅读每一则留言。",
    commentPlaceholder: "多分享一点您的感受...",
    skipAndSend: "跳过并提交",
    send: "提交反馈",
    sending: "正在提交...",
    submitError: "暂时无法提交，请再试一次。",
    successTitle: "谢谢您",
    successBody: "您的反馈已分享给{outlet}。",
    successCrew: "您对{name}的肯定已传达给团队。",
    tags: {
      Friendly: "亲切友善", Helpful: "乐于协助", Attentive: "细心周到", Fast: "效率迅速", Knowledgeable: "专业熟悉",
      Greeting: "招呼接待", "Response Time": "回应速度", Accuracy: "准确性", Cleanliness: "整洁卫生", "Product Knowledge": "产品知识",
      Taste: "口味", Portion: "份量", Temperature: "温度", Presentation: "摆盘", Value: "性价比", Freshness: "新鲜度",
      "Service Speed": "服务速度", Atmosphere: "氛围", Ordering: "点餐体验", "Waiting Time": "等候时间", Comfort: "舒适度", "Overall Value": "整体价值",
    },
  },
};

function outletFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#feedback\??/, ""));
  return params.get("outlet");
}

function outletTokenFromPath() {
  const match = window.location.pathname.match(/^\/feedback\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isPublicFeedbackRoute() {
  return Boolean(outletTokenFromPath() || window.location.hash.startsWith("#feedback"));
}

function publicFeedbackPath() {
  return outletTokenFromPath() ? "token" : "legacy";
}

function feedbackToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initials(value) {
  return (value || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function Avatar({ person, outlet = false }) {
  const [failed, setFailed] = useState(false);
  const image = outlet
    ? person?.logo_url || person?.brand_logo_url || person?.logo
    : person?.photo_url || person?.avatar_url;

  if (image && !failed) {
    return <img className="guest-feedback-avatar-image" src={image} alt="" onError={() => setFailed(true)} />;
  }

  return <span className="guest-feedback-avatar-fallback" aria-hidden="true">{initials(person?.name)}</span>;
}

function GuestState({ title, body, loading = false }) {
  return (
    <main className="guest-feedback-page guest-feedback-state-page">
      <section className="guest-feedback-state" aria-live="polite">
        <div className="guest-feedback-state-mark">{loading ? <Coffee size={23} /> : <Store size={23} />}</div>
        <h1>{title}</h1>
        {body && <p>{body}</p>}
      </section>
    </main>
  );
}

export default function CrewGuestFeedback() {
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("en");
  const [step, setStep] = useState("scope");
  const [direction, setDirection] = useState("forward");
  const [scope, setScope] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [experience, setExperience] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const t = copy[language];
  const publicPath = useMemo(publicFeedbackPath, []);
  const totalSteps = scope === "crew" ? 5 : 4;
  const progressStep = { scope: 1, crew: 2, experience: scope === "crew" ? 3 : 2, highlights: scope === "crew" ? 4 : 3, comment: totalSteps, done: totalSteps }[step] || 1;

  useEffect(() => {
    let active = true;
    const outletToken = outletTokenFromPath();
    const outletId = outletFromHash();

    async function load() {
      try {
        const result = outletToken
          ? await crewService.publicFeedbackEntry(outletToken)
          : await crewService.publicFeedbackCrew(outletId);
        if (!active) return;
        if (!result?.outlet) throw new Error("Feedback link is unavailable");
        setEntry(result);
      } catch (loadError) {
        if (active) setError(loadError.message || "Feedback link is unavailable");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, []);

  function advance(nextStep) {
    setDirection("forward");
    setStep(nextStep);
  }

  function chooseScope(nextScope) {
    setScope(nextScope);
    setEmployee(null);
    setExperience(null);
    setSelectedTags([]);
    setComment("");
    advance(nextScope === "crew" ? "crew" : "experience");
  }

  function chooseEmployee(nextEmployee) {
    setEmployee(nextEmployee);
    advance("experience");
  }

  function chooseExperience(nextExperience) {
    if (nextExperience !== experience) setSelectedTags([]);
    setExperience(nextExperience);
    advance("highlights");
  }

  function back() {
    setDirection("back");
    if (step === "crew") setStep("scope");
    if (step === "experience") setStep(scope === "crew" ? "crew" : "scope");
    if (step === "highlights") setStep("experience");
    if (step === "comment") setStep("highlights");
  }

  function toggleTag(tag) {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  async function submit(overrideComment) {
    if (!entry?.outlet || !scope || !experience || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const finalComment = overrideComment ?? comment;
    const payload = {
      outletToken: entry.outletToken || entry.outlet.public_feedback_token,
      scope,
      employeeId: scope === "crew" ? employee?.id : null,
      experience,
      positiveTags: experience === "needs_improvement" ? [] : selectedTags,
      improvementTags: experience === "needs_improvement" ? selectedTags : [],
      comment: finalComment,
      clientToken: feedbackToken(),
    };

    try {
      if (publicPath === "token") await crewService.submitPublicFeedbackV2(payload);
      else await crewService.submitPublicFeedback({ ...payload, outletId: entry.outlet.id });
      advance("done");
    } catch (submitFailure) {
      setSubmitError(submitFailure.message || t.submitError);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <GuestState title={t.loading} loading />;
  if (error || !entry?.outlet) return <GuestState title={t.unavailableTitle} body={t.unavailableBody} />;

  const availableTags = scope && experience ? tags[scope][experience] : [];
  const scopePrompt = scope === "crew" ? t.experience.crew.replace("{name}", employee?.name || "") : t.experience[scope];

  return (
    <main className="guest-feedback-page">
      <div className="guest-feedback-shell">
        <header className="guest-feedback-header">
          <div className="guest-feedback-brand">
            <span className="guest-feedback-brand-mark"><Avatar person={entry.outlet} outlet /></span>
            <strong>{entry.outlet.name}</strong>
          </div>
          <button className="guest-feedback-language" type="button" onClick={() => setLanguage((current) => current === "en" ? "zh" : "en")} aria-label="Switch language">
            <span className={language === "en" ? "is-active" : ""}>EN</span><i>|</i><span className={language === "zh" ? "is-active" : ""}>中文</span>
          </button>
        </header>

        {step !== "done" && (
          <div className="guest-feedback-progress" aria-label={`Step ${progressStep} of ${totalSteps}`}>
            {Array.from({ length: totalSteps }, (_, index) => <span key={index} className={index < progressStep ? "is-complete" : ""} />)}
          </div>
        )}

        <section key={`${step}-${language}`} className="guest-feedback-stage" data-direction={direction}>
          {step !== "scope" && step !== "done" && <button className="guest-feedback-back" type="button" onClick={back}><ChevronLeft size={18} />{language === "en" ? "Back" : "返回"}</button>}

          {step === "scope" && (
            <>
              <div className="guest-feedback-intro"><h1>{t.scopeQuestion}</h1><p>{t.scopeHint}</p></div>
              <div className="guest-feedback-choice-list">
                {scopes.map(({ value, icon: Icon }) => (
                  <button key={value} type="button" className="guest-feedback-choice" onClick={() => chooseScope(value)}>
                    <span className="guest-feedback-choice-icon"><Icon size={21} /></span>
                    <span><strong>{t.scope[value][0]}</strong><small>{t.scope[value][1]}</small></span>
                    <ChevronLeft className="guest-feedback-choice-arrow" size={19} />
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "crew" && (
            <>
              <div className="guest-feedback-intro"><h1>{t.crewQuestion}</h1><p>{t.crewHint}</p></div>
              <div className="guest-feedback-crew-list">
                {(entry.crew || []).map((row) => (
                  <button key={row.id} type="button" className="guest-feedback-crew" onClick={() => chooseEmployee(row)}>
                    <span className="guest-feedback-crew-avatar"><Avatar person={row} /></span>
                    <span><strong>{row.name}</strong><small>{row.position || (language === "en" ? "Team member" : "团队成员")}</small></span>
                    <ChevronLeft className="guest-feedback-choice-arrow" size={19} />
                  </button>
                ))}
              </div>
              <button className="guest-feedback-text-action" type="button" onClick={() => chooseScope("outlet")}>{t.cannotFind}</button>
            </>
          )}

          {step === "experience" && (
            <>
              <div className="guest-feedback-intro"><h1>{scopePrompt}</h1></div>
              <div className="guest-feedback-experience-list">
                {experiences.map(({ value, icon: Icon }) => (
                  <button key={value} type="button" className={`guest-feedback-experience ${value}`} onClick={() => chooseExperience(value)}>
                    <Icon size={29} strokeWidth={1.8} />
                    <strong>{t.experienceChoices[value][0]}</strong><small>{t.experienceChoices[value][1]}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "highlights" && (
            <>
              <div className="guest-feedback-intro"><h1>{t.highlights[experience]}</h1><p>{t.highlightsHint}</p></div>
              <div className="guest-feedback-tags">
                {availableTags.map((tag) => <button key={tag} type="button" className={selectedTags.includes(tag) ? "is-selected" : ""} onClick={() => toggleTag(tag)}>{selectedTags.includes(tag) && <Check size={15} />}{t.tags[tag]}</button>)}
              </div>
              <button className="guest-feedback-primary" type="button" onClick={() => advance("comment")}>{t.continue}</button>
            </>
          )}

          {step === "comment" && (
            <>
              <div className="guest-feedback-intro"><h1>{t.commentQuestion}</h1><p>{t.commentHint}</p></div>
              <textarea className="guest-feedback-comment" autoFocus value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t.commentPlaceholder} rows={3} maxLength={1000} />
              {submitError && <p className="guest-feedback-submit-error" role="alert">{submitError}</p>}
              <div className="guest-feedback-submit-actions">
                <button className="guest-feedback-secondary" type="button" disabled={submitting} onClick={() => submit("")}>{t.skipAndSend}</button>
                <button className="guest-feedback-primary" type="button" disabled={submitting} onClick={() => submit()}>{submitting ? t.sending : <><Send size={17} />{t.send}</>}</button>
              </div>
            </>
          )}

          {step === "done" && (
            <div className="guest-feedback-success" aria-live="polite">
              <div className="guest-feedback-success-mark"><Check size={27} /></div>
              <h1>{t.successTitle}</h1>
              <p>{t.successBody.replace("{outlet}", entry.outlet.name)}</p>
              {scope === "crew" && employee && <p className="guest-feedback-success-note">{t.successCrew.replace("{name}", employee.name)}</p>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
