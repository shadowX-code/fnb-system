# Crew Localization

## Purpose And Scope

This domain owns the localized content layer used by Crew-facing SOP, Task, and Onboarding experiences.
It covers source language, EN/zh-CN/ms content, translation lifecycle, fallback, provider boundaries, and frozen localized snapshots.

## Canonical Ownership

Current localized-content migrations, service contracts, translation Edge Function, locale resources, snapshot behavior, RLS, and tests are authoritative.
Source business content remains owned by Crew Learning or Crew Operations.
Localization owns language variants and their lifecycle, not the source workflow's business state.

## Core Entities

- Localizable content units and stable unit keys
- Canonical source language and source value/version references
- EN, zh-CN, and ms translation records
- Translation status, provider metadata, review state, manual edits, and source-change markers
- Frozen localized snapshots attached to published or assigned content
- UI locale preferences and deterministic fallback rules

## Lifecycle And Business Rules

The saved source content is canonical.
A source must exist before translation is requested.
Changing a saved source marks dependent translations outdated rather than silently treating them as current.

Translation generation crosses a provider boundary through the established trusted service.
Provider output is a draft translation, not a replacement for source authority.
Manual edits and reviewed translations are protected from accidental regeneration through the current confirmation and lifecycle rules.

Runtime presentation resolves the requested locale, then applies the defined fallback to available content and ultimately the canonical source.
Missing translation must never hide required operational or learning content.
Published/assigned workflows freeze the localized values needed to preserve what Crew saw at that version.

## Permissions, Versions, And Audit

Authorized Admin content editors may request, edit, review, or regenerate translations within source-domain scope.
Crew receives only safe localized content through eligible task, SOP, or onboarding read models.
Source version references, status changes, reviewed/manual edits, provider provenance, and frozen snapshots retain traceability.
Provider credentials remain server-side.

## Admin And Crew Workflows

Admins save source drafts, request translations, review or manually edit language variants, resolve outdated content, and publish through the owning source domain.
Crew select or inherit a supported locale and consume eligible localized content with deterministic fallback.

## Integrations

Crew Learning supplies SOP, onboarding, lesson, and quiz source units and owns their publication/assignment state.
Crew Operations supplies task and Daily Operations source units and owns execution state.
Crew Workforce supplies the Crew session and preference context where applicable.

## Compatibility And Deferred Scope

Localization is cross-feature but remains a bounded domain because it has independent data, authority, lifecycle, and provider integration.
It does not own general Admin-interface translation.
Additional locales, human translation marketplaces, glossary management, and translation memory are deferred unless introduced explicitly.
