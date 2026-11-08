import googleLogo from "../assets/google-g-logo.png";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import GoogleReviewerAvatar from "./GoogleReviewerAvatar.jsx";
import "./CrewGuestVoice.css";

const ROTATE_MS = 7000;
const REFRESH_MS = 60000;
const PAGE_SIZE = 20;
const motionQuery = "(prefers-reduced-motion: reduce)";

function Stars({ value }) {
  const { t } = useTranslation();
  const displayValue = Math.round(value * 10) / 10;
  return <span className="crew-guest-stars" role="img" aria-label={t("guestVoice.stars", { value: displayValue })}>
    {Array.from({ length: 5 }, (_, index) => <span key={index} aria-hidden="true">
      <Star size={15} fill="currentColor" />
      <i style={{ width: `${Math.max(0, Math.min(1, displayValue - index)) * 100}%` }}><Star size={15} fill="currentColor" /></i>
    </span>)}
  </span>;
}

function Review({ review }) {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" });
  return <>
    <span className="crew-guest-review-meta">
      <GoogleReviewerAvatar reviewer={review.reviewer} />
      <span className="crew-guest-review-byline">
        <strong>{review.reviewer?.displayName || t("guestVoice.anonymous")}</strong>
        <time dateTime={review.date}>{date.format(new Date(review.date))}</time>
      </span>
      <Stars value={review.rating} />
    </span>
    {review.comment && <span className="crew-guest-comment">{review.comment}</span>}
  </>;
}

export default function CrewGuestVoice({ token, outletId, outletName }) {
  const { t, i18n } = useTranslation();
  const [feed, setFeed] = useState(null);
  const [active, setActive] = useState(0);
  const [overlay, setOverlay] = useState(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia(motionQuery).matches);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [glow, setGlow] = useState(null);
  const previous = useRef(null);
  const newIds = useRef(new Set());
  const gesture = useRef(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const motion = window.matchMedia(motionQuery);
    const onMotion = () => setReduced(motion.matches);
    const onVisibility = () => setVisible(!document.hidden);
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!token || !outletId || !visible) return undefined;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await crewService.guestVoice(token, outletId, controller.signal);
        if (controller.signal.aborted) return;
        const last = previous.current;
        if (next.status === "ready" && last?.revision === next.revision && Date.parse(next.fetchedAt) > Date.parse(last.fetchedAt)) {
          const seen = new Set(last.reviews.map(({ id }) => id));
          for (const review of next.reviews) {
            if (!seen.has(review.id) && Date.parse(review.date) > Date.parse(last.fetchedAt)) newIds.current.add(review.id);
          }
        } else if (next.status !== "ready" || last?.revision !== next.revision) {
          newIds.current.clear();
          setGlow(null);
          setActive(0);
          setOverlay(null);
        }
        previous.current = next.status === "ready" ? next : null;
        setFeed(next);
      } catch {
        if (!controller.signal.aborted) {
          previous.current = null;
          newIds.current.clear();
          setGlow(null);
          setFeed({ status: "unavailable" });
          setOverlay(null);
        }
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [token, outletId, visible]);

  useEffect(() => {
    if (feed?.status !== "ready") return undefined;
    const timer = window.setTimeout(() => {
      setFeed({ status: "awaiting_sync" });
      setOverlay(null);
    }, Math.max(0, Date.parse(feed.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [feed]);

  const status = feed?.status === "ready" && Date.parse(feed.expiresAt) <= Date.now()
    ? "awaiting_sync" : feed?.status;
  const reviews = status === "ready" ? feed.reviews : [];
  const slides = [...reviews.filter(review => review.comment.trim()), ...reviews.filter(review => !review.comment.trim())].slice(0, 5);
  const currentIndex = Math.min(active, slides.length - 1);
  const current = slides[currentIndex];

  useEffect(() => {
    if (slides.length < 2 || !visible || reduced || hovered || focused || dragging || overlay) return undefined;
    const timer = window.setTimeout(() => setActive((current) => (current + 1) % slides.length), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [active, slides.length, visible, reduced, hovered, focused, dragging, overlay]);

  useEffect(() => {
    const isNew = current && newIds.current.delete(current.id);
    setGlow(isNew && !reduced ? current.id : null);
  }, [current?.id, reduced, feed?.fetchedAt]);

  function move(delta) {
    setActive((currentIndex + delta + slides.length) % slides.length);
  }

  function finishGesture(event) {
    const start = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy)) {
      suppressClick.current = true;
      move(dx < 0 ? 1 : -1);
    }
  }

  if (!outletId || !status) return null;
  const selected = overlay && overlay !== "all" ? reviews.find(review => review.id === overlay) : null;

  return <section className="crew-guest-voice" aria-label={t("guestVoice.title")}>
    <header className="crew-guest-header">
      <span className="crew-guest-source" aria-hidden="true"><img src={googleLogo} alt="" width={20} height={20} /></span>
      <span><h2>{t("guestVoice.title")}</h2>{outletName && <small>{outletName}</small>}</span>
      {reviews.length > 0 && <button type="button" onClick={() => { setLimit(PAGE_SIZE); setOverlay("all"); }}>{t("common.viewAll")} <ChevronRight size={16} /></button>}
    </header>
    {status === "ready" && (feed.rating !== null || feed.total !== null) && <div className="crew-guest-rating">
      {feed.rating !== null && <strong>{feed.rating.toLocaleString(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>}
      <span>{feed.rating !== null && <Stars value={feed.rating} />}
        {feed.total !== null && <small>{t("guestVoice.count", { count: feed.total })}</small>}
      </span>
    </div>}
    {current ? <div className="crew-guest-carousel"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }}>
      <div className="crew-guest-swipe"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          suppressClick.current = false;
          gesture.current = { x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
        onPointerUp={finishGesture}
        onPointerLeave={() => { gesture.current = null; setDragging(false); }}
        onPointerCancel={() => { gesture.current = null; setDragging(false); }}>
        <button type="button" key={current.id} className={`crew-guest-review${glow === current.id ? " is-new" : ""}`}
          onClick={(event) => {
            if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; }
            setOverlay(current.id);
          }}>
          <Review review={current} />
        </button>
      </div>
      {slides.length > 1 && <div className="crew-guest-dots">{slides.map((review, index) => <button
        type="button" key={review.id} aria-label={t("guestVoice.slide", { index: index + 1, count: slides.length })}
        aria-current={index === currentIndex ? "true" : undefined} onClick={() => setActive(index)} />)}
      </div>}
    </div> : <p className="crew-guest-fallback">{t(`guestVoice.${status === "ready" ? "empty" : status}`)}</p>}
    {overlay === "all" && reviews.length > 0 && <CrewBottomSheet title={t("guestVoice.title")} description={outletName} onClose={() => setOverlay(null)}>
      <div className="crew-guest-list">{reviews.slice(0, limit).map(review => <button type="button" className="crew-guest-review" key={review.id} onClick={() => setOverlay(review.id)}><Review review={review} /></button>)}</div>
      {limit < reviews.length && <button type="button" className="crew-mobile-secondary" onClick={() => setLimit(limit + PAGE_SIZE)}>{t("inventory.loadMore")}</button>}
    </CrewBottomSheet>}
    {selected && <CrewBottomSheet title={t("guestVoice.detail")} description={t("guestVoice.title")} onClose={() => setOverlay(null)}>
      <article className="crew-guest-review crew-guest-detail"><Review review={selected} /></article>
      <button type="button" className="crew-mobile-secondary" onClick={() => setOverlay("all")}>{t("common.viewAll")}</button>
    </CrewBottomSheet>}
  </section>;
}
