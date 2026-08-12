import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "SetupContentLibrary",
  description: "Creates the content_library table and seeds the initial PSM Playbook row.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  async run(ctx) {
    // Create table if not exists
    await ctx.integrations.db.execute(
      `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.CONTENT_LIBRARY (
        ID TEXT NOT NULL,
        NAME TEXT NOT NULL,
        DISPLAY_NAME TEXT NOT NULL,
        DESCRIPTION TEXT,
        CONTENT TEXT,
        CATEGORY TEXT NOT NULL,
        LINKED_SKILL TEXT,
        UPDATED_BY TEXT,
        UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        PRIMARY KEY (ID),
        UNIQUE (NAME)
      )`,
      [],
      { label: "Create content_library table" }
    );

    // Check if seed row already exists
    const existing = await ctx.integrations.db.query(
      `SELECT ID FROM SCRATCH_DATA.SALES.CONTENT_LIBRARY WHERE NAME = ? LIMIT 1`,
      z.object({ ID: z.string() }),
      ["psm_playbook"],
      { label: "Check if PSM playbook exists" }
    );

    if (existing.length > 0) {
      return { success: true, message: "Table exists and PSM Playbook already seeded." };
    }

    // Insert the PSM Playbook seed row
    const playbookContent = `# PSM Playbook — Account Action Item Logic

## Priority Rules (evaluate in order, apply all that match)

### Critical — Act This Week
- NAR < 2%: Activation fundamentals failing. Immediate leasing office engagement required. Check D2C marketing rights status, resident communication cadence, and payment portal visibility.
- Month-over-month trend < -3pp AND NAR < 10%: Sharp decline. Schedule call before next billing period closes. Diagnose root cause: new move-outs, portal issues, or leasing team turnover.

### At Risk — Act Within 2 Weeks
- Month-over-month trend < -1pp: Softening trend. Proactive check-in. Identify if seasonal, structural, or operational.
- NAR < 10%: Below target. Review rollout completeness, PMS integration status, and resident awareness.

### Activation Focus
- Months since rollout < 3: New account. Confirm leasing team training completion, D2C marketing setup, and payment portal go-live. Run onboarding checklist.
- New activations > 60% of bills paid: High dependency on first-time users. Existing resident re-engagement needed — email campaigns, in-app nudges, renewal bundling.

### Retention Focus
- Repeat users > 80% of bills paid: Strong loyalty base but limited growth. Push new unit promotions and leasing-office bundling to drive net-new activations.

### Escalation
- Months since rollout > 12 AND NAR < 5%: Stalled account. Flag for manager review. Full account audit: PMS setup, leasing team engagement, resident communication history.
- Units > 500 AND NAR < 10%: High-value under-performer. Escalate to executive engagement. Consider custom marketing plan or dedicated onboarding sprint.

### Growth Plays
- NAR >= 10% AND month-over-month trend > 1pp: Strong performer. Candidate for case study. Explore expansion to additional properties or portfolio upsell.

## Output Format
For each account, return 3–5 action items. Each item must have:
- priority: high, medium, or low
- category: activation, retention, growth, engagement, or escalation
- action: specific, concrete action (not generic advice)
- rationale: one sentence explaining why this applies to this account's numbers

## Tone
Direct and specific. Reference the account's actual numbers. No generic recommendations that could apply to any account.`;

    await ctx.integrations.db.execute(
      `INSERT INTO SCRATCH_DATA.SALES.CONTENT_LIBRARY (ID, NAME, DISPLAY_NAME, DESCRIPTION, CONTENT, CATEGORY, LINKED_SKILL, UPDATED_BY, UPDATED_AT)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP())`,
      [
        "psm_playbook",
        "psm_playbook",
        "PSM Playbook",
        "Rules and priorities for AI-generated account action items in the PSM Dashboard",
        playbookContent,
        "playbook",
        "generatePSMActionItems",
        "kumbi.murinda@getflex.com",
      ],
      { label: "Seed PSM Playbook document" }
    );

    return { success: true, message: "Table created and PSM Playbook seeded successfully." };
  },
});
