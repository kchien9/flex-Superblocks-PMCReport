---
name: Content Library Architecture
description: How the Content Library works for managing LLM prompts and
  instructional text. Use when building any module that uses Claude/AI, or when
  managing prompt content.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T18:10:09.713Z
---

# Content Library Architecture

## Purpose
Manages instructional text for Intelligence Skills — PSM playbooks, Claude prompt templates, coaching rubrics — so **non-engineers can edit them without touching code**.

## Current State (V1 — Direct Publish)
- Admins edit content in Content Library admin page → Save → live immediately on next execution
- No staging, no approval gate
- Acceptable risk for small team with low-frequency edits

## Planned (V2 — Staged Promotion)
Trigger: When Content Library has >3 active documents or a bad edit causes regression.
- Add `status` column: `draft | staging | production`
- Edits save as `draft` by default
- Admin promotes `draft → staging` for testing
- Kumbi promotes `staging → production`
- `getContextDocument(name)` reads `status = 'production'` only

## Which Modules Use Content Library
| Module | Skill | Document Name |
|--------|-------|---------------|
| PSM Dashboard | generatePSMActionItems | `psm_playbook` |
| Pre-Call Prep (future) | generateCallBrief | `call_prep_playbook` |
| Any future Claude module | — | — |

**Static modules** (Dashboard, Pricing Calculator, Leaderboard) do NOT use Content Library.

## Pattern for New Modules
1. Create a document in Content Library with your system prompt / instructions
2. In your `server/apis/` function, fetch via `GetContextDocument` API
3. Pass the fetched content as the system prompt to `ctx.integrations.ai`
4. Reference: `server/apis/psm-dashboard/generate-action-items.ts` for the pattern
