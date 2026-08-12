import { api, z, anthropic } from "@superblocksteam/sdk-api";

const ANTHROPIC = "0ba6b240-0e7e-4e31-89d5-4ca3dc7d21ff";

const DealContextInputSchema = z.object({
  personas: z.array(z.string()),
  focusAreas: z.array(z.string()),
  concerns: z.string(),
  notes: z.string(),
});

// Tool use response schema — Claude returns tool_use blocks when tool_choice is set
const ToolUseResponseSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.record(z.unknown()) }),
    ])
  ),
  model: z.string(),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

const BRIEF_SYSTEM = `You are PitchPrep, an AI sales intelligence tool built exclusively for Flex sales reps.
Your job is to generate a structured pre-call brief for a PMC (property management company) sales call.
Use the create_brief tool to return your output.

FLEX KNOWLEDGE BASE (use this as your source of truth for Flex stats and case studies):
---
{{knowledgeBaseText}}
---

AVAILABLE INTERNAL KB SOURCES (use these exact names when adding to the sources array):
  - "PMC Value | MetroSight Research Study Findings GTM" → https://www.notion.so/2bc4b351646a8029b374c0de0b881b4d
  - "PMC Value Proof Points" → https://www.notion.so/2e14b351646a808191a1ce7b16df5544
  - "Flex B2B | Jobs to Be Done" → https://www.notion.so/2fc4b351646a80f08eb2d5d1ff32da49
  - "Segmentation & Personas" → https://www.notion.so/3274b351646a81ecb293ca40112e449f
  - "PMC Personas" → https://www.notion.so/2fe4b351646a800b90d3c5fed4f6dbd6
  - "Sales Process 2.0" → https://www.notion.so/2764b351646a80ce9b7dccbdd00033f2
  - "Product Research" → https://www.notion.so/9ac75b51e59d4957b9b711908db2fff1
  - "Flex Rent Objection Handling Guide" (internal — no direct URL)
  - "Flex Sales Deck — April 2026 (Brad)" (internal — no direct URL)
  - "Flex Research Reports & Case Studies" (internal — no direct URL)

CONTENT RULES:
- Never fabricate statistics. Only cite data points from the knowledge base or account intel above.
- Never write "(based on public information)" anywhere.
- Never lead with late fee loss — it is an objection to handle, not a value pitch.
- The MetroSight study is the strongest proof point. Use it confidently when relevant.
- For 3rd Party Fee Manager accounts, front-load objection disarmament before pivoting to value delivery.
- pull_quote fields must mention this specific company by name or use a real number from their profile.
- Use **bold** markdown inside string fields (e.g. "body", "content", "response") for key figures.
- Use inline [N] citation markers in body, content, response, and account_status_bar fields wherever you reference a stat or fact that has a source. N is the 1-based index of that source in the sources array.`;

const BRIEF_USER_TEMPLATE = `Generate a pre-call brief for this PMC sales call.

ACCOUNT INTEL:
{{accountJson}}

DEAL CONTEXT:
- Personas in the room: {{personas}}
- What they want to improve: {{focusAreas}}
- What they're worried about: {{concerns}}
- Additional notes: {{dealNotes}}

FIELD RULES:
- hero_stats: 4-5 items. Choose the most compelling stats for THIS account.
- snapshot_cards: 3-4 items. Always include PORTFOLIO and COMPANY PROFILE. Set warning: true for market risk or regulatory headwind cards.
- value_pillars: 2-3 items most relevant to the personas and focus areas.
- talking_points: 6-8 items. Mix "ask" type questions and "point" type statements. Questions get a dark ASK badge.
- objections: 3-4 most likely for this account profile and deal context.
- sources: list every source cited. Each [N] reference must match the Nth item in this array.
- pull_quote: must mention this company by name OR use a specific number from their profile.
- recommended_slides: pick 3-5 slides from the Flex Sales Deck that would resonate most with this specific prospect.`;

// Brief schema as a tool — forces Claude to always emit valid, schema-conformant JSON
const BRIEF_TOOL = {
  name: "create_brief",
  description: "Create a structured pre-call sales brief for a property management company.",
  input_schema: {
    type: "object",
    properties: {
      company_name: { type: "string" },
      subtitle: { type: "string" },
      hero_stats: {
        type: "array",
        items: {
          type: "object",
          properties: { value: { type: "string" }, label: { type: "string" } },
          required: ["value", "label"],
        },
      },
      snapshot_cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            content: { type: "string" },
            warning: { type: "boolean" },
          },
          required: ["label", "content", "warning"],
        },
      },
      account_status_bar: { type: "string" },
      value_pillars: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            stat_line: { type: "string" },
            body: { type: "string" },
            pull_quote: { type: "string" },
          },
          required: ["title", "stat_line", "body", "pull_quote"],
        },
      },
      talking_points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["ask", "point"] },
            text: { type: "string" },
          },
          required: ["type", "text"],
        },
      },
      objections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            objection: { type: "string" },
            response: { type: "string" },
          },
          required: ["objection", "response"],
        },
      },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string" },
          },
          required: ["name"],
        },
      },
      recommended_slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slide_number: { type: "integer" },
            slide_title: { type: "string" },
            reason: { type: "string" },
          },
          required: ["slide_number", "slide_title", "reason"],
        },
      },
    },
    required: [
      "company_name", "subtitle", "hero_stats", "snapshot_cards",
      "account_status_bar", "value_pillars", "talking_points",
      "objections", "sources", "recommended_slides",
    ],
  },
};

export default api({
  name: "GenerateBrief",
  description: "Generates pre-call brief using tool_choice for structured output",

  integrations: {
    ai: anthropic(ANTHROPIC),
  },

  input: z.object({
    researchData: z.record(z.any()),
    dealContext: DealContextInputSchema,
    knowledgeBase: z.string().optional(),
  }),

  output: z.object({
    brief: z.record(z.any()),
    rawText: z.string(),
  }),

  async run(ctx, { researchData, dealContext, knowledgeBase }) {
    ctx.log.info("Generating pre-call brief", { company: researchData.company_name });

    const knowledgeBaseText = knowledgeBase || "(Knowledge base unavailable)";

    const systemPrompt = BRIEF_SYSTEM.replace("{{knowledgeBaseText}}", knowledgeBaseText);

    const userPrompt = BRIEF_USER_TEMPLATE
      .replace("{{accountJson}}", JSON.stringify(researchData, null, 2))
      .replace("{{personas}}", dealContext.personas.join(", ") || "Not specified")
      .replace("{{focusAreas}}", dealContext.focusAreas.join(", ") || "Not specified")
      .replace("{{concerns}}", dealContext.concerns || "Not specified")
      .replace("{{dealNotes}}", dealContext.notes || "None");

    const result = await ctx.integrations.ai.apiRequest(
      {
        method: "POST",
        path: "/v1/messages",
        body: {
          model: "claude-sonnet-4-6",
          max_tokens: 6000,
          system: systemPrompt,
          tools: [BRIEF_TOOL],
          tool_choice: { type: "tool", name: "create_brief" },
          messages: [{ role: "user", content: userPrompt }],
        },
      },
      { response: ToolUseResponseSchema },
      { label: "Claude brief generation (tool_choice)" }
    );

    // Extract the tool_use block
    let brief: Record<string, any> = {};
    let rawText = "";

    for (const block of result.content) {
      if (block.type === "tool_use" && block.name === "create_brief") {
        brief = block.input as Record<string, any>;
        rawText = JSON.stringify(block.input);
        break;
      }
    }

    if (!rawText) {
      // Fallback: try parsing text blocks if tool_use not found
      const textContent = result.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("");
      if (textContent) {
        try {
          const cleaned = textContent.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
          brief = JSON.parse(cleaned);
          rawText = cleaned;
        } catch {
          throw new Error("Brief generation failed — no structured output returned. Please try again.");
        }
      } else {
        throw new Error("Brief generation failed — no structured output returned. Please try again.");
      }
    }

    return { brief, rawText };
  },
});
