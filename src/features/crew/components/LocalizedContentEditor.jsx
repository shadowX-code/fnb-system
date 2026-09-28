import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Languages, RefreshCw, Sparkles } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import CrewRichContent from "./CrewRichContent.jsx";
import { crewService } from "../../../services/crewService.js";
import {
  CONTENT_LANGUAGE_OPTIONS,
  CONTENT_LANGUAGES,
  LOCALIZATION_STATUS,
  localizationLanguageStatus,
  localizationStatus,
} from "../utils/localizedContent.js";
import "./LocalizedContentEditor.css";

const CrewAdminRichTextEditor = lazy(() => import("./CrewAdminRichTextEditor.jsx"));

function LocalizedRichTextField({ value, label, disabled, onSave, onDirtyChange }) {
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { setDraft(value || ""); }, [value]);
  const changed = draft !== (value || "");
  return <div className="crew-localized-rich-field">
    <Suspense fallback={<span role="status">Loading editor…</span>}><CrewAdminRichTextEditor value={draft} onChange={(next) => { setDraft(next); onDirtyChange(next !== (value || "")); }} disabled={disabled} placeholder="Write translation…" /></Suspense>
    {changed ? <button type="button" className="btn-secondary" disabled={disabled} onClick={async () => { if (await onSave(draft)) onDirtyChange(false); }}>Save Translation</button> : null}
    <span className="sr-only">{label}</span>
  </div>;
}

export default function LocalizedContentEditor({ domain, versionId, sourceLanguage, onSourceLanguageChange, onHydrateSourceLanguage, onSaveSource, sourceUnits = [], sourceDirty = false, confirm, disabled = false }) {
  const comparison = domain === "task" || domain === "sop";
  const [payload, setPayload] = useState(null);
  const [language, setLanguage] = useState(comparison ? CONTENT_LANGUAGES.find((value) => value !== sourceLanguage) || "zh-CN" : sourceLanguage || "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pendingRich, setPendingRich] = useState({});
  const hasPendingRich = Object.values(pendingRich).some(Boolean);
  const units = payload?.units || {};
  const visibleUnits = useMemo(() => sourceUnits.map((sourceUnit) => ({ ...sourceUnit, stored: units[sourceUnit.unit_key] })), [sourceUnits, units]);
  const groupedUnits = useMemo(() => {
    if (domain !== "sop") return [{ key: "content", title: "", items: visibleUnits }];
    const groups = [];
    for (const unit of visibleUnits) {
      const section = unit.unit_key.match(/^(sections\.[^.]+)\./)?.[1];
      const key = section || "sop";
      let group = groups.find((item) => item.key === key);
      if (!group) {
        group = { key, title: section ? `Section ${String(groups.filter((item) => item.key !== "sop").length + 1).padStart(2, "0")}` : "SOP", items: [] };
        groups.push(group);
      }
      group.items.push(unit);
    }
    return groups.map((group) => ({ ...group, title: group.key === "sop" ? group.title : `${group.title} · ${group.items.find((item) => item.unit_key.endsWith(".title"))?.source_value || "Untitled"}` }));
  }, [domain, visibleUnits]);

  useEffect(() => { setLanguage((current) => comparison ? current === sourceLanguage ? CONTENT_LANGUAGES.find((value) => value !== sourceLanguage) : current : sourceLanguage || "en"); }, [sourceLanguage, comparison]);
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

  async function translateMissing(savedSourceUnits = null) {
    if ((sourceDirty && !savedSourceUnits) || hasPendingRich) {
      setError(hasPendingRich ? "Save the rich-text translation before continuing." : "Save Draft source changes before translating so translations use the canonical saved content.");
      return;
    }
    const canonicalUnits = savedSourceUnits || sourceUnits;
    setBusy(true); setError(""); setSuccess("");
    try {
      // Legacy drafts can have saved content but predate localized units.
      // Hydrate canonical units first; reviewed/manual targets stay protected.
      const saved = await crewService.saveLocalizedContentUnits(domain, versionId, canonicalUnits);
      const currentIds = canonicalUnits.map((source) => saved?.units?.[source.unit_key]?.id).filter(Boolean);
      if (comparison && currentIds.length !== canonicalUnits.length) throw new Error("Save the Draft source before generating translations.");
      const missingIds = canonicalUnits.map((source) => saved?.units?.[source.unit_key]).filter((unit) => unit?.id && !unit.translations?.[language]).map((unit) => unit.id);
      if (comparison && !missingIds.length) {
        setPayload(saved);
        setSuccess("No missing translations for this language");
        return;
      }
      const translated = await crewService.translateLocalizedContent(domain, versionId, comparison ? missingIds : null, comparison ? [language] : null);
      // The Edge Function response is read after the complete server-side apply.
      // Read again to prevent a previously-open editor from retaining stale units.
      const refreshed = await crewService.localizedContentAdmin(domain, versionId);
      setPayload(Object.keys(refreshed?.units || {}).length ? refreshed : translated);
      setSuccess("Translations generated · Saved");
    }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  async function saveAndTranslate() {
    if (!onSaveSource) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const savedUnits = await onSaveSource();
      if (!savedUnits) throw new Error("Unable to save the Draft source. Check the required fields and try again.");
      await translateMissing(savedUnits);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  async function reviewAll() {
    const reviewable = visibleUnits.map(({ stored, ...source }) => ({ stored, source }))
      .filter(({ stored, source }) => stored?.id && stored.source_language === sourceLanguage && JSON.stringify(stored.source_value) === JSON.stringify(source.source_value) && stored.translations?.[language]?.value && stored.translations[language].status === "ai_translated");
    if (!reviewable.length || hasPendingRich) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      for (const { stored } of reviewable) await crewService.reviewLocalizedTranslation(stored.id, language);
      setPayload(await crewService.localizedContentAdmin(domain, versionId));
      setSuccess(`${reviewable.length} translations marked Reviewed`);
    } catch (cause) {
      setPayload(await crewService.localizedContentAdmin(domain, versionId));
      setError(cause.message);
    } finally { setBusy(false); }
  }

  async function edit(unitId, nextValue) {
    if (!unitId) { setError("Save the Draft source before editing translations."); return; }
    setBusy(true); setError("");
    try { setPayload(await crewService.editLocalizedTranslation(unitId, language, nextValue)); return true; }
    catch (cause) { setError(cause.message); return false; }
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
      <div className="crew-localized-actions">
        {sourceDirty && onSaveSource ? <><small>Save Draft changes before translating the saved source.</small><button type="button" className="btn-secondary" disabled={disabled || busy || !versionId || hasPendingRich} onClick={saveAndTranslate}>Save Draft &amp; Translate</button></> : null}
        <button type="button" className="btn-secondary" disabled={disabled || busy || !versionId || sourceDirty || hasPendingRich} onClick={() => translateMissing()}><Sparkles size={15} /> {busy ? "Working…" : "Translate Missing"}</button>
        {comparison ? <button type="button" className="btn-ghost" disabled={disabled || busy || sourceDirty || hasPendingRich || !visibleUnits.some(({ stored, ...source }) => stored?.translations?.[language]?.value && stored.translations[language].status === "ai_translated" && JSON.stringify(stored.source_value) === JSON.stringify(source.source_value))} onClick={reviewAll}><Check size={15} /> Mark All Reviewed</button> : null}
      </div>
    </header>
    {comparison ? <div className="crew-localized-language-pair">
      <SelectField label="Source" ariaLabel="Source Language" value={sourceLanguage || "en"} disabled={disabled} onChange={onSourceLanguageChange} options={CONTENT_LANGUAGE_OPTIONS} />
      <span aria-hidden="true">→</span>
      <SelectField label="Translate to" ariaLabel="Translate to" value={language} onChange={(next) => { if (hasPendingRich) { setError("Save the rich-text translation before switching language."); return; } setLanguage(next); setPendingRich({}); setError(""); }} options={CONTENT_LANGUAGE_OPTIONS.filter((option) => option.value !== sourceLanguage)} />
      <small>{visibleUnits.filter(({ stored, ...source }) => stored?.translations?.[language]?.value && stored?.translations?.[language]?.status !== "outdated" && JSON.stringify(stored.source_value) === JSON.stringify(source.source_value)).length} of {visibleUnits.length} translated</small>
    </div> : <><div className="crew-localized-source">
      <SelectField label="Source Language" ariaLabel="Source Language" value={sourceLanguage || "en"} disabled={disabled} onChange={onSourceLanguageChange} options={CONTENT_LANGUAGE_OPTIONS} />
      <p>The source remains canonical. Changing it marks existing translations as Outdated after the Draft is saved.</p>
    </div><div className="crew-localized-tabs" role="tablist" aria-label="Localized content language">
      {CONTENT_LANGUAGE_OPTIONS.map((option) => {
        const status = localizationLanguageStatus(visibleUnits.map(({ stored }) => stored).filter(Boolean), option.value, sourceLanguage);
        return <button type="button" key={option.value} role="tab" aria-selected={language === option.value} className={language === option.value ? "is-active" : ""} onClick={() => setLanguage(option.value)}><span>{option.label}</span><Badge tone={LOCALIZATION_STATUS[status].tone}>{LOCALIZATION_STATUS[status].label}</Badge></button>;
      })}
    </div></>}
    <div className="crew-localized-units">
      {visibleUnits.length ? groupedUnits.map((group) => <div className="crew-localized-group" key={group.key}>{group.title ? <h3>{group.title}</h3> : null}{group.items.map(({ stored, ...sourceUnit }) => {
        const sourceChanged = stored && (stored.source_language !== sourceLanguage || JSON.stringify(stored.source_value) !== JSON.stringify(sourceUnit.source_value));
        const status = language === sourceLanguage ? "original" : sourceChanged && stored?.translations?.[language] ? "outdated" : localizationStatus(stored, language);
        const translation = stored?.translations?.[language];
        const isSource = language === (stored?.source_language || sourceLanguage);
        const currentValue = isSource ? sourceUnit.source_value : translation?.value ?? "";
        const fieldLabel = domain === "sop" ? sourceUnit.label?.replace(/^Section \d+ /, "").replace(/^./, (letter) => letter.toUpperCase()) : sourceUnit.label;
        return <article key={`${sourceUnit.unit_key}:${language}:${translation?.updated_at || status}`}>
          <div><strong>{fieldLabel || "Content"}</strong>{!comparison ? <Badge tone={LOCALIZATION_STATUS[status].tone}>{LOCALIZATION_STATUS[status].label}</Badge> : null}</div>
          {comparison ? <div className="crew-localized-comparison"><div><small>Source · {CONTENT_LANGUAGE_OPTIONS.find((option) => option.value === sourceLanguage)?.label}</small>{sourceUnit.field_kind === "rich_text" ? <CrewRichContent html={String(sourceUnit.source_value || "")} className="crew-localized-original" /> : <p className="crew-localized-original">{String(sourceUnit.source_value || "")}</p>}</div><div><div className="crew-localized-translation-heading"><small>Translation · {CONTENT_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label}</small><Badge tone={LOCALIZATION_STATUS[status].tone}>{status === "ai_translated" ? "Translated" : LOCALIZATION_STATUS[status].label}</Badge></div>{sourceUnit.field_kind === "rich_text" ? <LocalizedRichTextField key={`${sourceUnit.unit_key}:${language}:${translation?.updated_at || translation?.value || ""}`} value={String(translation?.value || "")} label={`${sourceUnit.label} ${language}`} disabled={!stored?.id || disabled || sourceDirty || busy} onSave={(value) => edit(stored?.id, value)} onDirtyChange={(dirty) => setPendingRich((current) => ({ ...current, [sourceUnit.unit_key]: dirty }))} /> : <textarea className="control" disabled={!stored?.id || disabled || sourceDirty || busy} defaultValue={String(translation?.value || "")} aria-label={`${sourceUnit.label} ${language}`} onBlur={(event) => event.target.value !== String(translation?.value || "") && edit(stored?.id, event.target.value)} placeholder={stored?.id ? "Missing translation" : versionId ? "Use Translate Missing to prepare this field" : "Save the Draft source first"} />}</div></div> : isSource ? <p className="crew-localized-original">{sourceUnit.field_kind === "rich_text" ? "Rich text source is edited in the content editor." : String(currentValue || "")}</p> : <textarea className="control" disabled={!stored?.id || disabled} defaultValue={String(currentValue || "")} aria-label={`${sourceUnit.label} ${language}`} onBlur={(event) => event.target.value !== String(currentValue || "") && edit(stored?.id, event.target.value)} placeholder={stored?.id ? "Missing translation" : "Save the Draft source first"} />}
          {!isSource ? <footer>{status === "outdated" ? <span><AlertTriangle size={14} /> Translation may be outdated</span> : <span />}{translation ? <span className="flex gap-2">{status === "outdated" ? <button type="button" className="btn-ghost" disabled={busy || disabled || sourceDirty} onClick={() => regenerate(stored, translation)}><RefreshCw size={14} /> Regenerate</button> : null}{status !== "reviewed" && status !== "outdated" ? <button type="button" className="btn-ghost" disabled={busy || disabled || sourceDirty} onClick={() => review(stored.id)}><Check size={14} /> Mark Reviewed</button> : null}</span> : null}</footer> : null}
        </article>;
      })}</div>) : <p className="crew-localized-empty">Save the Draft source once to create its translatable content units.</p>}
    </div>
    {error ? <p className="crew-localized-error" role="alert"><span>{error}</span>{versionId && !sourceDirty ? <button type="button" className="btn-ghost" disabled={busy || disabled} onClick={translateMissing}>Retry</button> : null}</p> : null}
    {success ? <p className="crew-localized-success" role="status"><Check size={14} /> {success}</p> : null}
    {!versionId ? <p className="crew-localized-note"><RefreshCw size={14} /> Save the Draft before generating translations.</p> : null}
  </section>;
}

export function LocalizationPublishSummary({ localization, sourceLanguage = "en" }) {
  const units = Object.values(localization?.units || {});
  return <section className="crew-localized-publish-summary"><h3>Language summary</h3>{CONTENT_LANGUAGES.map((language) => {
    const status = localizationLanguageStatus(units, language, sourceLanguage);
    return <div key={language}><span>{CONTENT_LANGUAGE_OPTIONS.find((item) => item.value === language)?.label}</span><Badge tone={LOCALIZATION_STATUS[status].tone}>{LOCALIZATION_STATUS[status].label}</Badge></div>;
  })}</section>;
}
