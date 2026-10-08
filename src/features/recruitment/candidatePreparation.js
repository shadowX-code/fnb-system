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
    interviewLanguage: "Interview language", change: "Change", consentRecorded: "Consent recorded",
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
    interviewLanguage: "面试语言", change: "更改", consentRecorded: "已记录同意", consentUnavailable: "暂时无法确认同意，请联系招聘团队。", retryReadiness: "重新检查准备状态",
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
