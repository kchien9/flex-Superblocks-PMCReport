---
name: App Architecture and Layout
description: Application shell structure including sidebar, top bar, and page
  layout. Use when creating new pages or modifying the app shell.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T18:44:54.488Z
---

# Application Architecture

## Shell Layout (App.tsx)
```
┌─────────────────────────────────────────────┐
│ ImpersonationBanner (full width, conditional)│
├──────────┬──────────────────────────────────┤
│          │  TopBar                          │
│ Sidebar  ├──────────────────────────────────┤
│ (purple) │  Page Content (<Outlet />)       │
│          │  bg: #F7F7F7, overflow-auto      │
└──────────┴──────────────────────────────────┘
```

## Context Providers (in order)
1. `AppProvider` (Superblocks library — DO NOT REMOVE)
2. `PermissionsProvider`
3. `ImpersonationProvider`

## Sidebar
- Collapsible (240px expanded, 60px collapsed)
- Purple background (`#6A3DB8`)
- Active state: `bg-white/15` + left border
- Admin section with expandable Settings group
- Shows user avatar + name at bottom

## Routing
- Uses React Router with lazy-loaded pages
- All pages are direct children of the app shell
- PSM Dashboard has a nested detail route: `/psm-dashboard/:pmcId`

## API Organization
- APIs grouped by domain in `server/apis/` (e.g., `dashboard/`, `psm-dashboard/`, `pitch-prep/`)
- All registered in `server/apis/index.ts`
- Use descriptive file names (e.g., `get-pipeline-data.ts`, `generate-action-items.ts`)
