import CrewMobileApp from "../features/crew/CrewMobileApp.jsx";
import ToastViewport from "../components/feedback/ToastViewport.jsx";
import useToasts from "../components/feedback/useToasts.js";

export default function CrewEntry() {
  const { toasts, notify, dismiss } = useToasts();
  return <>
    <CrewMobileApp onNotify={notify} />
    <ToastViewport toasts={toasts} onDismiss={dismiss} style={{ right: "max(16px, calc((100vw - 430px) / 2 + 16px))", bottom: "calc(var(--crew-mobile-nav-height) + env(safe-area-inset-bottom) + 82px)" }} />
  </>;
}
