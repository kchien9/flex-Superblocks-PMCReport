---
name: Module Builder Process
description: The mandatory process for building new modules or migrating
  existing apps into Revenue OS. Use whenever creating a new module, migrating
  an external app, or reviewing whether a build follows the correct workflow.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T18:10:09.710Z
---

# Module Builder Process

## Core Principle
All modules are built **directly inside Revenue OS** — never as separate Superblocks apps first, and never lifted-and-shifted as-is. Building outside breaks design system inheritance, bypasses RBAC, and recreates fragmentation.

## Process A — Net-New Module
1. **Define** — Write a brief (what it does, who uses it, what data, success criteria). Share with Kumbi before proceeding.
2. **Register in Module Registry** — Status: `Coming Soon`, roles defined, one-sentence description. Also add to Permissions matrix and Sidebar nav.
3. **Check Skills Registry** — Does a Workflow already exist? If yes, call it. Don't rewrite.
4. **Build directly inside Revenue OS** — New page via Clark. Inherits design system, sidebar, RBAC automatically.
5. **Audit for Skill Extraction** — Any SOQL query or Claude prompt reusable? Extract as Workflow → register in Skills Registry.
6. **PR and Approval** — Feature branch → PR to `flexapp/revenue-os`. Kumbi approves all PRs (CODEOWNERS).
7. **Activate** — Flip Module Registry status `Coming Soon → Active`, set `lastUpdated` to today. Confirm permissions.

## Process B — Migrating an Existing App
1. **Define in Revenue OS context** — Ask "what should this module be?" not "how do we port it?"
2. **Extract shared logic into Workflows first** — SOQL → Data Skills, Claude prompts → Intelligence Skills.
3. **Rebuild UI inside Revenue OS** — Reference original app for *functional requirements only*, not design/layout.
4. **Run in parallel** — Keep original running until Revenue OS version validated by real users.
5. **Deprecate and activate** — After user sign-off, decommission old app, activate module.

## Mandatory Sync Points

These three files must always stay in sync when modules are created, modified, or removed:
1. **Module Registry** — `client/pages/ModuleRegistry/index.tsx` → `mockModules` array
2. **Permissions matrix** — `client/pages/Permissions/index.tsx` → `modules` array
3. **Sidebar nav** — `client/components/Sidebar/index.tsx` → nav items

When modifying an existing module significantly, update `lastUpdated` in the Module Registry.

## PR Checklist (every module PR)
- [ ] Module registered in Module Registry with correct roles and `lastUpdated`
- [ ] Permissions matrix `modules` array updated
- [ ] Sidebar nav item added/updated
- [ ] Skills Registry checked — no duplicate logic introduced
- [ ] Any new reusable logic extracted as a Workflow and registered
- [ ] Screenshot of the module UI in Revenue OS
- [ ] Tested with at least one non-admin user role
