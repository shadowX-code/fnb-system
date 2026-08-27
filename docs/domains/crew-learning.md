# Crew Learning

## Purpose And Scope

This domain owns Crew onboarding journeys, SOP Library, structured learning content, quizzes, learning progress, and the learning-side relationship to skills and certification.

## Canonical Ownership

Current SOP, journey, module, lesson, quiz, assignment, progress, acknowledgement, publication, RPC, RLS, and tests are authoritative.
Crew Localization owns translation records and localized snapshot rules.
Crew Performance and Reward owns operational certification outcomes and performance use of learning evidence.

## Core Entities

- SOP records, versions, publication state, acknowledgement requirements, and attachments
- Onboarding/learning journeys, versions, modules, lessons, quizzes, and availability order
- Journey assignments, pinned content snapshots, progress, attempts, scores, and acknowledgements
- Skill or certification references produced by successful learning where current contracts define them

## Lifecycle And Business Rules

Admin content progresses through controlled draft, publication, and new-version lifecycles.
Published versions are immutable; edits create a new draft/version rather than rewriting Crew history.
Assignments pin the learning and SOP versions needed for reproducible progression.

Crew availability follows the configured sequential or non-sequential rules.
Quiz validation and scoring are server-authoritative.
SOP acknowledgement and required lesson completion gate downstream progress where configured.
Safe Crew read models expose only assigned or otherwise eligible published content.

Learning completion may produce evidence used for skills or certification, but the operational status or reward consequence belongs to Crew Performance and Reward.

## Permissions, Versions, And Audit

Admins require learning/content permissions and applicable outlet scope to author, publish, version, assign, or retire content.
Crew access is token-bound to the current employee and safe content payloads.
Published versions, pinned assignment snapshots, quiz attempts/scores, acknowledgements (including their canonical acknowledgement timestamp), and completed progress are immutable evidence.

## Admin And Crew Workflows

Admins author SOPs and journeys, configure sequencing and quizzes, publish versions, assign learning, and monitor progress.
Crew view assigned onboarding and learning, read pinned SOP content, acknowledge requirements, complete lessons, and submit quizzes.

## Integrations

Crew Workforce provides employee eligibility and secure Crew sessions.
Crew Localization manages EN, zh-CN, and ms translations and freezes localized assignment snapshots.
Crew Operations may reference published SOPs from tasks.
Crew Performance and Reward consumes controlled completion, skill, or certification evidence.
Factory Production SOP is separate factory-owned master data unless deliberately linked through a contract.

## Compatibility And Deferred Scope

Legacy Crew Onboarding routes resolve to the canonical Crew Learning owner.
SOP Library and Onboarding stay grouped because they share versioned learning content and progress rules.
External LMS synchronization, live training sessions, and generalized course commerce are deferred.
