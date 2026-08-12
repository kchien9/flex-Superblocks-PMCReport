---
name: Non-Negotiable Module Rules
description: Hard rules that must never be violated when building any module in
  Revenue OS. Use when creating APIs, handling LLM calls, managing prompts, or
  starting any module build.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T18:57:30.462Z
---

# Non-Negotiable Module Rules

| Rule | Why |
|------|-----|
| **No client-side LLM calls, no embedded API keys** | All LLM calls go through `server/apis/` using `ctx.integrations.ai`. Hardcoded keys = compromised — flag to Kumbi for rotation. |
| **Prompts live in Content Library, not in code** | Static instructional text (system prompts, tone rules, examples) goes in Admin → Content Library, fetched at runtime via `GetContextDocument`. Keeps prompts editable without code changes. |
| **Register before building** | Every module must exist in Module Registry before a line of Superblocks code is written. |
| **Check Skills Registry before writing new logic** | If another module already has the query/prompt you need, call that Workflow — don't rewrite it. |
| **Never build outside Revenue OS** | No separate Superblocks apps. No lift-and-shift. Rebuild correctly within the platform. |

## For Migrations Specifically
- Use the original app as the **spec for what the module should do** — not as code to port line-by-line
- Do NOT copy the original app's UI/layout — Clark builds the UI fresh, inheriting Revenue OS design system
- Original routing/auth is deleted — Revenue OS uses `ctx.user.email` and the shared permissions system
- Any in-memory state between requests = new scope that needs discussion
