---
name: LLM API Pattern
description: How to build server-side LLM calls in Revenue OS using the
  Anthropic integration. Use when creating any API that calls Claude or
  generates AI content.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T20:14:31.902Z
---

# LLM API Pattern

## Integration
- **Anthropic API Key - Parent-Revenue-Department** (`0ba6b240-0e7e-4e31-89d5-4ca3dc7d21ff`)
- Access via `ctx.integrations.ai.apiRequest` against `/v1/messages`

## Reference Implementation
Model on: `server/apis/psm-dashboard/generate-action-items.ts`

## Architecture
```
[User Input] → [server/apis/ function] → [Fetch prompt from Content Library] → [Call Anthropic via ctx.integrations.ai] → [Return structured output]
```

## Rules
1. **Never call LLM from the frontend** — all calls go through `server/apis/`
2. **Never hardcode API keys** — use the configured Anthropic integration
3. **System prompts come from Content Library** — fetched at runtime via `GetContextDocument`
4. **User input is the only dynamic part** passed directly in the API call
5. **Return structured data** (not raw HTML) — let React render the UI
