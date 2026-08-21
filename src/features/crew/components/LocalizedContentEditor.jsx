import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Languages, RefreshCw, Sparkles } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import {
  CONTENT_LANGUAGE_OPTIONS,
  CONTENT_LANGUAGES,
  LOCALIZATION_STATUS,
  localizationStatus,
} from "../utils/localizedContent.js";
import "./LocalizedContentEditor.css";

export default function LocalizedContentEditor({ domain, versionId, sourceLanguage, onSourceLanguageChange, onHydrateSourceLanguage, sourceUnits = [], sourceDirty = false, confirm, disabled = false }) {
  const [payload, setPayload] = useState(null);
  const [language, setLanguage] = useState(sourceLanguage || "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const units = payload?.units || {};
  const visibleUnits = useMemo(() => sourceUnits.map((sourceUnit) => ({ ...sourceUnit, stored: units[sourceUnit.unit_key] })), [sourceUnits, units]);

  useEffect(() => { setLanguage(sourceLanguage || "en"); }, [sourceLanguage]);
  useEffect(() => {
    if (!versionId) return;
    let active = true;
    crewService.localizedContentAdmin(domain, versionId).then((value) => {
      if (!active) return;
      setPayload(value);
      const storedSource = Object.values(value?.units || {})[0]?.source_language;
      if (storedSource && CONTENT_LANGUAGES.includes(storedSource)) onHydrateSourceLanguage?.(storedSource);
    }).catch((cause) => active && setError(cause.message));
    return () => { active = false; };
  }, [domain, versionId, onHydrateSourceLanguage]);

  async function translateMissing() {
    if (sourceDirty) {
      setError("Save Draft source changes before translating so translations use the canonical saved content.");
      return;
    }
    setBusy(true); setError("");
    try {
      // Legacy drafts can have saved content but predate localized units.
      // Hydrate canonical units first; reviewed/manual targets stay protected.
      await crewService.saveLocalizedContentUnits(domain, versionId, sourceUnits);
      setPayload(await crewService.translateLocalizedContent(domain, versionId));
    }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  async function edit(unitId, nextValue) {
    if (!unitId) { setError("Save the Draft source before editing translations."); return; }
    setBusy(true); setError("");
    try { setPayload(await crewService.editLocalizedTranslation(unitId, language, nextValue)); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  async function review(unitId) {
    setBusy(true); setError("");
    try { setPayload(await crewService.reviewLocalizedTranslation(unitId, language)); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  async function regenerate(stored, translation) {
    const protectedTranslation = Boolean(translation?.manually_edited_at || translation?.status === "reviewed");
    if (protectedTranslation) {
      const approved = await confirm?.({
        title: "Replace this reviewed translation?",
        message: "This translation contains manual or reviewed edits. Regenerating will replace the current translation.",
        confirmLabel: "Regenerate Translation",
        tone: "warning",
      });
      if (!approved) return;
    }
    setBusy(true); setError("");
    try { setPayload(await crewService.translateLocalizedContent(domain, versionId, [stored.id], [language], protectedTranslation)); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return <section className="crew-localized-editor" aria-label="Business content languages">
    <header>
      <div><Languages size={18} /><span><strong>Content languages</strong><small>Business content only · UI labels use the Crew language catalog.</small></span></div>
      <button type="button" className="btn-secondary" disabled={disabled || busy || !versionId} onClick={translateMissing}><Sparkles size={15} /> {busy ? "Translating…" : "Translate Missing"}</button>
    </header>
    <div className="crew-localized-source">
      <SelectField label="Source Language" ariaLabel="Source Language" value={sourceLanguage || "en"} disabled={disabled} onChange={onSourceLanguageChange} options={CONTENT_LANGUAGE_OPTIONS} />
      <p>The source remains canonical. Changing it marks existing translations as Outdated after the Draft is saved.</p>
    </div>
    <div className="crew-localized-tabs" role="tablist" aria-label="Localized content language">
      {CONTENT_LANGUAGE_OPTIONS.map((option) => {
        const statuses = visibleUnits.map(({ stored }) => localizationStatus(stored, option.value));
        const status = option.value === sourceLanguage ? "original" : statuses.includes("outdated") ? "outdated" : statuses.includes("missing") ? "missing" : statuses.includes("ai_translated") ? "ai_translated" : "reviewed";
        return <button type="button" key={option.value} role="tab" aria-selected={language === option.value} className={language === option.value ? "is-active" : ""} onClick={() => setLanguage(option.value)}><span>{option.label}</span><Badge tone={LOCALIZATION_STATUS[status].tone}>{LOCALIZATION_STATUS[status].label}</Badge></button>;
      })}
    </div>
    <div className="crew-localized-units">
      {visibleUnits.length ? visibleUnits.map(({ stored, ...sourceUnit }) => {
        const status = language === sourceLanguage ? "original" : localizationStatus(stored, language);
        const translation = stored?.translations?.[language];
        const isSource = language === (stored?.source_language || sourceLanguage);
        const currentValue = isSource ? sourceUnit.source_value : translation?.value ?? "";
        return <article key={`${sourceUnit.unit_key}:${language}:${translation?.updated_at || status}`}>
          <div><strong>{sourceUnit.label || sourceUnit.unit_key}</strong><Badge tone={LOCALIZATION_STATUS[status].tone}>{LOCALIZATION_STATUS[status].label}</Badge></div>
          {isSource ? <p className="crew-localized-original">{sourceUnit.field_kind === "rich_text" ? "Rich text source is edited in the content editor." : String(currentValue || "")}</p> : <textarea className="control" disabled={!stored?.id || disabled} defaultValue={String(currentValue || "")} aria-label={`${sourceUnit.label} ${language}`} onBlur={(event) => event.target.value !== String(currentValue || "") && edit(stored?.id, event.target.value)} placeholder={stored?.id ? "Missing translation" : "Save the Draft source first"} />}
          {!isSource ? <footer>{status === "outdated" ? <span><AlertTriangle size={14} /> Translation may be outdated</span> : <span />}{translation ? <span className="flex gap-2">{status === "outdated" ? <button type="button" className="btn-ghost" disabled={busy} onClick={() => regenerate(stored, translation)}><RefreshCw size={14} /> Regenerate</button> : null}{status !== "reviewed" && status !== "outdated" ? <button type="button" className="btn-ghost" disabled={busy} onClick={() => review(stored.id)}><Check size={14} /> Mark Reviewed</button> : null}</span> : null}</footer> : null}
        </article>;
      }) : <p className="crew-localized-empty">Save the Draft source once to create its translatable content units.</p>}
    </div>
    {error ? <p className="crew-localized-error" role="alert"><span>{error}</span>{versionId && !sourceDirty ? <button type="button" className="btn-ghost" disabled={busy || disabled} onClick={translateMissing}>Retry</button> : null}</p> : null}
    {!versionId ? <p className="crew-localized-note"><RefreshCw size={14} /> Save the Draft before generating translations.</p> : null}
  </section>;
}

export function LocalizationPublishSummary({ localization, sourceLanguage = "en" }) {
  const units = Object.values(localization?.units || {});
  return <section className="crew-localized-publish-summary"><h3>Language summary</h3>{CONTENT_LANGUAGES.map((language) => {
    const statuses = units.map((unit) => localizationStatus(unit, language));
    const status = language === sourceLanguage ? "original" : statuses.includes("outdated") ? "outdated" : statuses.includes("missing") || !statuses.length ? "missing" : statuses.includes("ai_translated") ? "ai_translated" : "reviewed";
    return <div key={language}><span>{CONTENT_LANGUAGE_OPTIONS.find((item) => item.value === language)?.label}</span><Badge tone={LOCALIZATION_STATUS[status].tone}>{LOCALIZATION_STATUS[status].label}</Badge></div>;
  })}</section>;
}
