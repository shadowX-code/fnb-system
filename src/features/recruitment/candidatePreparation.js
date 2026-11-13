// Interface language is presentation only; it never sets spoken preference.
export const preparationText = {
  en: {
    details: "Interview details", detailsGuidance: "Let’s get you ready for your interview.",
    workplace: "Workplace", duration: "Expected duration", minutes: n => `About ${n} minutes`,
    whatToExpect: "What to expect", conversation: "A conversation about your experience and working with the team.",
    preferredLanguage: "Preferred interview language", languageGuidance: "This is your starting language. You can switch languages naturally during the interview.",
    yourDetails: "Your details", edit: "Edit", done: "Done", name: "Candidate name", contact: "Contact number",
    saving: "Saving…", continue: "Continue", getReady: "Get ready",
    deviceGuidance: "Find a quiet, comfortable place. Speak briefly to check your microphone.",
    cameraPreview: "Your camera preview", camera: "Camera", microphone: "Microphone", connection: "Connection",
    ready: "Ready", notReady: "Not ready", checking: "Checking…", microphoneActivity: "Microphone activity",
    online: "Browser online", offline: "Offline", openingDevices: "Opening camera & microphone…", enableDevices: "Enable camera & microphone",
    interfaceLanguage: "Page language", interviewLanguage: "Spoken interview language", change: "Change",
    consentUnavailable: "Please contact your recruiter; consent is not available yet.", retryReadiness: "Retry readiness check",
    start: "Start interview", keepOpen: "Recording begins when you start. Keep this page open and your screen active.",
    interview: "Interview", preparing: "Preparing interview…", loadError: "Could not load your interview", retry: "Try again",
    linkUnavailable: "Interview link unavailable", linkUnavailableReason: "This link may have expired, been revoked, or the opening may have closed. Please contact your recruiter.",
  },
  zh: {
    details: "面试详情", detailsGuidance: "让我们一起准备面试。", workplace: "工作地点", duration: "预计时长", minutes: n => `约 ${n} 分钟`,
    whatToExpect: "面试内容", conversation: "聊聊你的工作经验，以及与团队合作的经历。",
    preferredLanguage: "首选面试语言", languageGuidance: "这是面试开始时使用的语言。面试中可自然切换语言。",
    yourDetails: "你的资料", edit: "编辑", done: "完成", name: "姓名", contact: "联系电话", saving: "保存中…", continue: "继续",
    getReady: "准备面试", deviceGuidance: "请找一个安静、舒适的地方。说几句话，检查麦克风。",
    cameraPreview: "摄像头预览", camera: "摄像头", microphone: "麦克风", connection: "网络连接", ready: "已就绪", notReady: "未就绪", checking: "检查中…",
    microphoneActivity: "麦克风音量", online: "浏览器已联网", offline: "未联网", openingDevices: "正在开启摄像头和麦克风…", enableDevices: "开启摄像头和麦克风",
    interfaceLanguage: "页面语言", interviewLanguage: "面试对话语言", change: "更改", consentUnavailable: "暂时无法确认同意，请联系招聘团队。", retryReadiness: "重新检查准备状态",
    start: "开始面试", keepOpen: "开始面试后将进行录制。请保持此页面打开，屏幕亮着。",
    interview: "面试", preparing: "正在准备面试…", loadError: "无法加载面试", retry: "重试", linkUnavailable: "面试链接无法使用",
    linkUnavailableReason: "链接可能已过期、被撤销，或职位已关闭。请联系招聘团队。",
  },
};
export function consentPresentation(copy = {}, language) {
  // Translate only from the canonical versioned snapshot. Never replace a
  // historical acceptance with new wording or an unversioned translation.
  return copy?.translations?.[language] || copy || {};
}
export function preparationDeviceError(message, language) {
  if (language !== "zh" || !message) return message;
  if (/access was denied/.test(message)) return "摄像头或麦克风权限被拒绝。请在浏览器设置中允许使用这两个设备，然后重试。";
  if (/cannot access/.test(message)) return "此浏览器无法使用摄像头和麦克风。";
  if (/missing device/.test(message)) return "面试需要摄像头和麦克风。请连接缺少的设备后重试。";
  if (/in use by another app/.test(message)) return "设备暂时无法使用或正在被其他应用使用。请关闭该应用后重试。";
  if (/timed out/.test(message)) return "开启摄像头和麦克风超时，请重试。";
  return "设备检查失败。请重新连接摄像头和麦克风，然后重试。";
}

const journeyText = {
  en: {
    confirmDetails: "Confirm details", saveLanguage: "Save language", cancel: "Cancel",
    saveError: "We couldn’t save your changes. Try again.",
    readinessError: "We couldn’t check that you’re ready. Try again.",
    loadErrorDetail: "Check your connection and try again.",
    starting: "Starting your interview", continuing: "Continuing your interview",
    startFailed: "Your interview hasn’t started", interrupted: "Interview paused",
    startHelp: "Check your connection and make sure your camera and microphone are allowed.",
    resumeHelp: "Continue when you’re ready. We’ll pick up from your saved interview.",
    retryStart: "Retry start", resume: "Continue interview",
    submitting: "Submitting your interview", submittingHelp: "Keep this page open while we confirm your submission.",
    submitFailed: "Submission not yet confirmed", submitHelp: "Check your connection and retry to finish submitting your interview.",
    retrySubmit: "Retry submission",
    listening: "Listening", speaking: "Speaking", thinking: "Thinking", connecting: "Connecting",
    speakNow: "You can speak now.", interviewer: "FeedX interviewer", you: "You", recording: "Recording",
    waitingForQuestion: "The interviewer's question will appear here.",
    elapsed: "Elapsed time", finish: "End interview", checkingFinish: "Checking…",
    stop: "Stop and submit partial interview", stopHeading: "Submit a partial interview?",
    stopHelp: "The hiring team will receive the responses saved so far and see that your interview was incomplete.",
    confirmStop: "Submit partial interview", keepInterviewing: "Keep interviewing",
    answerUnclear: "We didn’t catch that clearly. You can say it again or check the words below.",
    useWords: "Use these words", discardWords: "Discard words", interrupt: "I’d like to speak",
    answerNotReady: "Finish speaking, then try again.", interruptionNotReady: "Wait until the interviewer finishes, then speak.",
    finishUnavailable: "We couldn’t check if your interview is ready to submit. Try again.",
    moreNeeded: "The interviewer needs a little more information. You can continue or submit a partial interview.",
    offlineInterview: "You’re offline. Reconnect to continue.",
    continueFailed: "We couldn’t reconnect. Check your connection and try again.",
    audioHelp: "Check your sound and try again.",
    devicesHelp: "Check that your camera and microphone are allowed, then try again.",
    transcriptionHelp: "We couldn’t hear your last answer clearly. Continue to try again.",
    interferenceHelp: "Try earphones or a quieter place before continuing.",
    hiddenHelp: "Return to this page before continuing.",
    recoveryWarning: "Your most recent responses may still be saving.",
    completed: "Interview submitted", completedHelp: "Thank you. The hiring team will review your interview.",
    partial: "Partial interview submitted", partialHelp: "The hiring team can review the responses you submitted.",
    failed: "Interview needs attention", failedHelp: "Please contact the hiring team for the next step.",
    completedOn: "Submitted on", closePage: "You can now close this page.",
  },
  zh: {
    confirmDetails: "确认资料", saveLanguage: "保存语言", cancel: "取消",
    saveError: "未能保存更改，请重试。",
    readinessError: "未能确认准备状态，请重试。",
    loadErrorDetail: "请检查网络连接后重试。",
    starting: "正在开始面试", continuing: "正在继续面试",
    startFailed: "面试尚未开始", interrupted: "面试已暂停",
    startHelp: "请检查网络连接，并确认浏览器已获准使用摄像头和麦克风。",
    resumeHelp: "准备好后继续，我们会从已保存的面试接着进行。",
    submitting: "正在提交面试", submittingHelp: "请保持页面打开，等待提交确认。",
    submitFailed: "尚未确认提交", submitHelp: "请检查网络连接，然后重试提交。",
    retryStart: "重试开始", resume: "继续面试", retrySubmit: "重试提交",
    listening: "正在聆听", speaking: "正在说话", thinking: "正在思考", connecting: "正在连接",
    speakNow: "现在可以说话。", interviewer: "FeedX 面试官", you: "你", recording: "录制中",
    waitingForQuestion: "面试官的问题会显示在这里。",
    elapsed: "已用时间", finish: "结束面试", checkingFinish: "正在检查…",
    stop: "停止并提交部分面试", stopHeading: "提交未完成的面试？",
    stopHelp: "招聘团队会收到已保存的回答，并看到你的面试尚未完成。",
    confirmStop: "提交部分面试", keepInterviewing: "继续面试",
    answerUnclear: "刚才的回答没有听清楚。你可以再说一次，或查看下方识别到的文字。",
    useWords: "使用这些文字", discardWords: "舍弃文字", interrupt: "我想发言",
    answerNotReady: "请说完后重试。", interruptionNotReady: "请等面试官说完再回答。",
    finishUnavailable: "暂时无法确认面试是否可以提交，请重试。",
    moreNeeded: "面试官还需要了解一些信息。你可以继续回答，或提交未完成的面试。",
    offlineInterview: "网络已断开，请重新连接后继续。",
    continueFailed: "未能重新连接。请检查网络后重试。",
    audioHelp: "请检查声音设置后重试。",
    devicesHelp: "请确认浏览器已获准使用摄像头和麦克风，然后重试。",
    transcriptionHelp: "未能听清你刚才的回答。请继续面试并重试。",
    interferenceHelp: "请尝试使用耳机，或到更安静的地方继续。",
    hiddenHelp: "请返回此页面后继续。",
    recoveryWarning: "你刚才的部分回答可能仍在保存。",
    completed: "面试已提交", completedHelp: "感谢你的参与。招聘团队将查看你的面试。",
    partial: "部分面试已提交", partialHelp: "招聘团队可以查看你已提交的回答。",
    failed: "面试需要处理", failedHelp: "请联系招聘团队了解下一步。",
    completedOn: "提交时间", closePage: "你现在可以关闭此页面。",
  },
};

export function candidateText(language) {
  const locale = language === "zh" ? "zh" : "en";
  return { ...preparationText[locale], ...journeyText[locale] };
}
