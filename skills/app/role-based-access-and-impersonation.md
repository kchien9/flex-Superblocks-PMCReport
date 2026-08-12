---
name: Role-Based Access and Impersonation
description: How permissions and role-based access control work in this app. Use
  when building features that need to respect user roles or visibility rules.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T18:36:04.699Z
---

# Permissions & Impersonation System

## Roles
- `Admin` — Full access to all modules and settings
- `Senior Manager` — Full access to all modules and settings
- `RevOps Lead` — Dashboard, Pricing Calculator access
- `Sales Manager` — Dashboard, Pricing Calculator, Leaderboard
- `AE` (Account Executive) — Dashboard, Pricing Calculator, Leaderboard
- `SDR` (Sales Dev Rep) — Dashboard, Pricing Calculator only
- `PSM` (Property Success Manager) — Dashboard, PSM Dashboard

## Admin Roles (can see Settings section)
- Admin
- Senior Manager

## Impersonation
- Admins can impersonate other users to test role-based visibility
- Impersonation is tracked in an audit log with start/end timestamps and duration
- An `ImpersonationBanner` displays at the top of the app during impersonation
- The sidebar dynamically shows/hides modules based on the impersonated role

## Implementation
- `PermissionsContext` stores module → role visibility mappings
- `ImpersonationContext` manages the impersonated user state
- Sidebar reads both contexts to determine what to show
