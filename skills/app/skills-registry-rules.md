---
name: Skills Registry Rules
description: When and how to extract shared logic into the Skills Registry. Use
  when auditing modules for reusable logic or deciding whether to create a new
  Workflow.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T19:50:21.662Z
---

# Skills Registry Rules

## When to Extract as a Shared Skill
Extract logic as a named Workflow when:
- **Two or more modules** use the same SOQL query or close variant
- **Two or more modules** use the same Claude prompt pattern
- A query is **complex enough** that inconsistency across modules would create data integrity risk

## When NOT to Extract
- Do **not** extract speculatively
- Wait until the **second module** needs the same logic, then extract
- Single-use logic stays inline in the module's own `server/apis/` files

## Skill Types
- **Data Skills** — Reusable Salesforce SOQL queries
- **Intelligence Skills** — Reusable Claude prompt patterns

## Audit Checklist (before every PR)
1. Did this module introduce any SOQL query another module might need?
2. Did this module introduce a Claude prompt that could be reused?
3. If yes to either → extract as Workflow → register in Skills Registry **before** committing as inline logic
