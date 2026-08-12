import { api, z, snowflake, anthropic } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";
const ANTHROPIC_API = "0ba6b240-0e7e-4e31-89d5-4ca3dc7d21ff";

// Account input schema (matches getPSMNARData output shape)
const CurrentMetricsSchema = z.object({
  adoptionRate: z.number().nullable(),
  billsPaid: z.number(),
  units: z.number(),
  properties: z.number(),
  rentPaid: z.number().nullable(),
  newActivations: z.number(),
  repeatUsers: z.number(),
  newActivationsPct: z.number().nullable(),
  repeatUsersPct: z.number().nullable(),
  monthsFromRollout: z.number().nullable(),
  month: z.string(),
});

const AccountInputSchema = z.object({
  pmcId: z.string(),
  pmcName: z.string(),
  salesforceId: z.string().nullable(),
  psm: z.string().nullable(),
  psmEmail: z.string().nullable(),
  pms: z.string().nullable(),
  current: CurrentMetricsSchema.nullable(),
  trendDelta: z.number(),
  health: z.enum(["Critical", "At Risk", "Healthy"]),
  vsTarget: z.number().nullable(),
  history: z.array(z.object({
    month: z.string(),
    adoptionRate: z.number().nullable(),
    billsPaid: z.number(),
    units: z.number(),
  })),
});

// Output action item schema
const ActionItemSchema = z.object({
  priority: z.enum(["high", "medium", "low"]),
  category: z.enum(["activation", "retention", "growth", "engagement", "escalation"]),
  action: z.string(),
  rationale: z.string(),
});

// Anthropic response schema
const AnthropicResponseSchema = z.object({
  id: z.string(),
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

// Schema for content library query
const ContentDocSchema = z.object({
  CONTENT: z.string().nullable(),
});

export default api({
  name: "GeneratePSMActionItems",
  description: "Generates AI action items for a PSM account using Claude and the PSM Playbook.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
    ai: anthropic(ANTHROPIC_API),
  },

  input: z.object({
    account: AccountInputSchema,
    supportHealth: z.object({
      openTickets: z.number(),
      ticketsLastMonth: z.number(),
      ticketsPriorMonth: z.number(),
      momChange: z.number(),
      momChangePct: z.number().nullable(),
      residentIssuePct: z.number(),
      bankChangePct: z.number(),
      totalTickets3mo: z.number(),
      avgCsat: z.number().nullable(),
      topCategory: z.string().nullable(),
    }).nullable().optional(),
  }),

  output: z.object({
    accountName: z.string(),
    items: z.array(ActionItemSchema),
  }),

  async run(ctx, { account, supportHealth }) {
    // STEP 1 — Fetch both playbooks from Content Library in parallel
    const [narRows, supportRows] = await Promise.all([
      ctx.integrations.db.query(
        `SELECT CONTENT FROM SCRATCH_DATA.SALES.CONTENT_LIBRARY WHERE NAME = ? LIMIT 1`,
        ContentDocSchema,
        ["psm_playbook"],
        { label: "Fetch NAR Playbook" }
      ),
      ctx.integrations.db.query(
        `SELECT CONTENT FROM SCRATCH_DATA.SALES.CONTENT_LIBRARY WHERE NAME = ? LIMIT 1`,
        ContentDocSchema,
        ["support_health_playbook"],
        { label: "Fetch Support Health Playbook" }
      ),
    ]);

    const narPlaybook = narRows[0]?.CONTENT ?? "No NAR playbook found. Generate general best-practice action items.";
    const supportPlaybook = supportRows[0]?.CONTENT ?? "No support playbook available.";

    // STEP 2 — Build Claude prompt with support health data
    const a = account;
    const rate = ((a.current?.adoptionRate || 0) * 100).toFixed(1);
    const trend = (a.trendDelta * 100).toFixed(1);
    const trendDir = a.trendDelta >= 0 ? "+" : "";
    const newActPct = ((a.current?.newActivationsPct || 0) * 100).toFixed(0);
    const repeatPct = ((a.current?.repeatUsersPct || 0) * 100).toFixed(0);
    const months = Math.round(a.current?.monthsFromRollout || 0);

    // Build support health section
    const s = supportHealth;
    const supportSection = s ? `
SUPPORT HEALTH DATA (Zendesk PH tickets, last 3 months):
Open tickets: ${s.openTickets}
Tickets last month: ${s.ticketsLastMonth} (prior month: ${s.ticketsPriorMonth}, MoM: ${s.momChange >= 0 ? "+" : ""}${s.momChange})
Resident issue rate: ${(s.residentIssuePct * 100).toFixed(0)}% of tickets
Bank account change rate: ${(s.bankChangePct * 100).toFixed(0)}% of tickets
Top category: ${s.topCategory || "unknown"}
Total tickets (3mo): ${s.totalTickets3mo}
CSAT: ${s.avgCsat ? s.avgCsat.toFixed(1) + "/5" : "no data"}
` : "SUPPORT HEALTH DATA: No ticket data available for this PMC.";

    const prompt = `You are a PSM advisor at Flex, a rent-splitting fintech.

NAR PLAYBOOK:
${narPlaybook}

SUPPORT HEALTH PLAYBOOK:
${supportPlaybook}

ACCOUNT NAR DATA:
Account: ${a.pmcName}
PMS: ${a.pms}
Health: ${a.health}
Current NAR: ${rate}% (target: 10%)
Month-over-month trend: ${trendDir}${trend}pp
New activations: ${newActPct}% of bills paid
Repeat users: ${repeatPct}% of bills paid
Months since rollout: ${months}
Total units: ${a.current?.units || 0}
Bills paid this month: ${a.current?.billsPaid || 0}

${supportSection}

Generate 3-5 action items. When support data is available, explicitly distinguish between operational issues (tickets signal) and activation gaps (no ticket signal). Reference specific numbers from both datasets.
Return ONLY a valid JSON array:
[{ "priority": "high|medium|low", "category": "activation|retention|growth|engagement|escalation", "action": "specific action", "rationale": "one sentence" }]`;

    // STEP 3 — Call Claude
    const result = await ctx.integrations.ai.apiRequest(
      {
        method: "POST",
        path: "/v1/messages",
        body: {
          model: "claude-haiku-4-5",
          max_tokens: 800,
          temperature: 0.3,
          system: "You are a PSM advisor. Return valid JSON only — no markdown, no text outside the array.",
          messages: [{ role: "user", content: prompt }],
        },
      },
      { response: AnthropicResponseSchema },
      { label: `Generate action items for ${a.pmcName}` }
    );

    const raw = result.content.find((c) => c.type === "text")?.text ?? "";

    // STEP 4 — Parse response
    let items: z.infer<typeof ActionItemSchema>[];
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      // Validate each item against schema
      items = parsed.map((item: unknown) => ActionItemSchema.parse(item));
    } catch {
      items = [{
        priority: "medium",
        category: "engagement",
        action: "Review account manually — AI response could not be parsed",
        rationale: "Parsing error",
      }];
    }

    return { accountName: a.pmcName, items };
  },
});
