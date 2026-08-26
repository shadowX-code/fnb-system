import { useState } from "react";
import { Activity, Bot, BrainCircuit, Cable, Clock3, Cpu, Mic, Monitor, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import GuestAiDeviceConsolePage from "./GuestAiDeviceConsolePage.jsx";
import { useGuestAiDeviceRuntime } from "../device/session/GuestAiDeviceRuntimeContext.jsx";

const capabilityLabels = { display: "Display", servo_x: "Servo X", servo_y: "Servo Y", speaker: "Speaker", microphone: "Microphone", camera: "Camera", wifi: "Wi-Fi" };

function RuntimeStatus({ title, value, detail, tone = "neutral", icon: Icon = Activity }) {
  return <div className="rounded-2xl border border-border bg-surface p-4"><Icon size={18} className="text-primary" /><div className="mt-4 flex items-center justify-between gap-2"><span className="font-semibold text-text-primary">{title}</span><Badge tone={tone}>{value}</Badge></div><p className="mt-2 text-xs text-text-secondary">{detail}</p></div>;
}

function DeviceSummary({ onOpenDeveloper }) {
  const { snapshot } = useGuestAiDeviceRuntime();
  const online = snapshot.connection === "online";
  return <Card title="K151 device" description="Current local Web Serial device session; no fleet data is persisted.">
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Device ID" value={snapshot.device?.id ?? "Awaiting snapshot"} />
        <Field label="Model" value={snapshot.device?.model ?? "—"} />
        <Field label="Firmware" value={snapshot.device?.firmware_version ?? "—"} />
        <Field label="Protocol" value={snapshot.device?.protocol_version ?? "—"} />
        <Field label="Robot state" value={snapshot.robotState ?? "OFFLINE"} />
        <Field label="Last heartbeat" value={snapshot.lastSeen ? new Date(snapshot.lastSeen).toLocaleString("en-MY") : "—"} />
      </dl>
      <div className="flex flex-col items-start gap-3"><Badge tone={online ? "success" : snapshot.connection === "reconnecting" ? "warning" : "neutral"}>{snapshot.connection}</Badge><button type="button" className="btn-secondary" onClick={onOpenDeveloper}>Open Developer Console</button></div>
    </div>
  </Card>;
}

function Field({ label, value }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt><dd className="mt-1 font-semibold text-text-primary">{value}</dd></div>; }

export function GuestAiOverviewPage({ ui }) {
  const { snapshot } = useGuestAiDeviceRuntime();
  const online = snapshot.connection === "online";
  return <div className="space-y-4">
    <PageHeader section="Guest AI · Overview" title="AI Guest Experience" description="Independent Guest AI workspace for bounded device, voice, and runtime ownership." />
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <RuntimeStatus title="Device health" value={online ? "ONLINE" : "OFFLINE"} detail={online ? "K151 snapshot and heartbeat are available." : "Connect through Developer to restore a local session."} tone={online ? "success" : "neutral"} icon={Bot} />
      <RuntimeStatus title="Voice runtime" value="PASS" detail="Mic → STT → LLM → TTS → K151 speaker loop validated." tone="success" icon={Volume2} />
      <RuntimeStatus title="STT provider" value="PROVISIONAL" detail="gpt-4o-transcribe; Malaysia code-switch optimization remains deferred." tone="warning" icon={Mic} />
      <RuntimeStatus title="Hardware Foundation" value="FROZEN" detail="K151 camera, microphone, speaker, USB and runtime safety foundation." tone="success" icon={ShieldCheck} />
      <RuntimeStatus title="Audio Transport" value="FROZEN" detail="Bounded PCM capture and prebuffer playback contract." tone="success" icon={Cable} />
      <RuntimeStatus title="Natural Interaction" value="FROZEN" detail="Transient bounded context and follow-up interaction behavior." tone="success" icon={Sparkles} />
    </div>
    <DeviceSummary onOpenDeveloper={() => ui.navigate("guest_ai_developer")} />
  </div>;
}

export function GuestAiDevicesPage({ ui }) {
  const { snapshot } = useGuestAiDeviceRuntime();
  return <div className="space-y-4">
    <PageHeader section="Guest AI · Devices" title="Device ownership" description="Canonical operational view for Guest AI robots and their local protocol health." />
    <DeviceSummary onOpenDeveloper={() => ui.navigate("guest_ai_developer")} />
    <Card title="Capabilities" description="Reported directly by the K151 firmware snapshot."><div className="divide-y divide-border">{Object.entries(capabilityLabels).map(([key, label]) => <div className="flex items-center justify-between px-4 py-3 text-sm" key={key}><span>{label}</span><Badge tone={snapshot.capabilities[key] === "pass" ? "success" : snapshot.capabilities[key] === "partial" ? "warning" : snapshot.capabilities[key] === "blocked" ? "danger" : "neutral"}>{snapshot.capabilities[key] ?? "unknown"}</Badge></div>)}</div></Card>
    <Card title="Foundation status" description="Current device is validated as a single bounded Guest AI device; fleet inventory is not invented."><div className="grid gap-3 p-4 md:grid-cols-3"><RuntimeStatus title="Hardware" value="FROZEN" detail="Validated K151 foundation." tone="success" icon={ShieldCheck} /><RuntimeStatus title="Protocol" value="HEALTHY" detail={snapshot.error ? `Current error: ${snapshot.error}` : "Snapshot, heartbeat, and canonical device protocol."} tone={snapshot.error ? "danger" : "success"} icon={Cpu} /><RuntimeStatus title="Runtime" value={snapshot.robotState ?? "OFFLINE"} detail="Robot state is authoritative firmware telemetry." tone={snapshot.robotState === "ERROR" ? "danger" : "info"} icon={Activity} /></div></Card>
  </div>;
}

export function GuestAiInteractionsPage() {
  return <div className="space-y-4"><PageHeader section="Guest AI · Interactions" title="Interactions" description="Guest conversation history is intentionally not persisted in this foundation." /><Card title="Privacy-first interaction history"><div className="p-4"><EmptyState title="No persisted interactions yet." description="PCM, WAV, transcripts, replies, and interaction context remain transient and are cleared from the active session." /></div></Card></div>;
}

export function GuestAiStudioPage() {
  return <div className="space-y-4"><PageHeader section="Guest AI · AI Studio" title="AI runtime" description="Current bounded runtime configuration; this page does not create a prompt CMS, knowledge base, or persistent AI settings." /><div className="grid gap-4 lg:grid-cols-2"><StudioCard title="Speech Recognition" icon={Mic} rows={[["Provider / model", "OpenAI · gpt-4o-transcribe"], ["Status", "PROVISIONAL"], ["Language", "Auto-detect; mixed-language fidelity optimization deferred"]]} /><StudioCard title="Conversation" icon={BrainCircuit} rows={[["Provider / model", "OpenAI · gpt-4o-mini"], ["Context", "Latest 3 completed turns, transient only"], ["Natural Interaction", "FROZEN"]]} /><StudioCard title="Voice" icon={Volume2} rows={[["Provider / model", "OpenAI · gpt-4o-mini-tts"], ["Development voice", "alloy (server-configurable)"], ["Playback budget", "6 s · 288,000 bytes · 24 kHz S16LE mono"]]} /><StudioCard title="Expressions" icon={Sparkles} rows={[["IDLE", "neutral"], ["LISTENING", "listening"], ["THINKING / SYNTHESIZING", "thinking"], ["SPEAKING", "speaking"]]} /></div></div>;
}

function StudioCard({ title, icon: Icon, rows }) { return <Card title={title} action={<Icon size={18} className="text-primary" />}><dl className="divide-y divide-border">{rows.map(([label, value]) => <div className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[170px_1fr]" key={label}><dt className="font-semibold text-text-secondary">{label}</dt><dd className="text-text-primary">{value}</dd></div>)}</dl></Card>; }

export function GuestAiDeveloperPage({ ui }) {
  const [tab, setTab] = useState("device");
  const targetByTab = { device: "guest-ai-device-tools", voice: "guest-ai-voice-tools", diagnostics: "guest-ai-diagnostics" };
  const selectTab = (next) => { setTab(next); requestAnimationFrame(() => document.getElementById(targetByTab[next])?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  return <div className="space-y-4"><PageHeader section="Guest AI · Developer" title="Developer Console" description="Local Web Serial, voice runtime evidence, and capability diagnostics. All device traffic remains in the existing canonical console." /><Card title="Developer views" description="One shared console; tabs only navigate to its existing bounded sections."><div className="flex flex-wrap gap-2 p-4" role="tablist" aria-label="Guest AI developer views">{[["device", "Device"], ["voice", "Voice"], ["diagnostics", "Diagnostics"]].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "btn-primary" : "btn-secondary"} onClick={() => selectTab(id)}>{label}</button>)}</div></Card><GuestAiDeviceConsolePage ui={ui} /></div>;
}
