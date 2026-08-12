import { api, z, anthropic } from "@superblocksteam/sdk-api";

const ANTHROPIC = "0ba6b240-0e7e-4e31-89d5-4ca3dc7d21ff";

// Strict pronoun/POV rules from reference implementation
const POV_RULES = `
CRITICAL PRONOUN/POV RULES — follow these exactly:
- You are the PROSPECT. You say "I", "we", "our company", "my team".
- The user is the SALES REP. You refer to them as "you", "your team", "Flex".
- NEVER say "I'm a Flex rep" or "we at Flex" — that is the REP's identity, not yours.
- NEVER break character. If confused, default to skeptical prospect behavior.
- Always respond in character as the prospect executive described below.
`;

const SYSTEM_PROMPTS: Record<string, string> = {
  open_call: `You are roleplaying as a realistic property management company (PMC) prospect in a sales call with a Flex rep. You are a VP of Operations or Revenue leader at the company described below.
${POV_RULES}
Behavior:
- Be realistic — engaged but skeptical. Ask clarifying questions. Push back where appropriate.
- Speak naturally, like a real exec on a discovery call. Keep responses to 2-4 sentences max.
- Reference your company's real concerns and priorities from the context provided.
- Don't be a pushover — make the rep earn your interest.
- If the rep uses specific data points about your company, acknowledge them realistically.
- Bring up your own priorities and pain points organically in conversation.

After your response, provide 2-3 suggested phrases the rep could say next. These should be specific, natural things a real sales rep would say in this moment — personalized to this company. Format them as a JSON array in a special block at the end of your response like this:
[SUGGESTIONS]["phrase 1", "phrase 2", "phrase 3"][/SUGGESTIONS]`,

  objection_drill: `You are roleplaying as a DIFFICULT property management company prospect who pushes back HARD on everything the Flex rep says. Your job is to stress-test their pitch.
${POV_RULES}
Behavior:
- Find a reason to object to EVERY statement. Be aggressive but realistic.
- Use real objections PMCs have: budget concerns, integration complexity, resident disruption, legal review, "we already have a solution", timeline pushback, contract lock-in fears, ROI skepticism.
- Keep responses short and punchy — 1-3 sentences max. Hit hard and fast.
- Don't give ground easily. Make them work for every inch.
- Reference specific details from the company context to make objections feel real.
- Escalate difficulty over time — start with soft pushback, get harder with each exchange.

After your response, provide 2-3 suggested phrases the rep could say next. These should be strong responses to your objection — specific to the context. Format them as a JSON array:
[SUGGESTIONS]["phrase 1", "phrase 2", "phrase 3"][/SUGGESTIONS]`,

  opener_only: `You are evaluating a sales rep's opening line for a call with a PMC prospect. You are a sales coach, not the prospect.
${POV_RULES.replace(/You are the PROSPECT.*?behavior.\n/s, "You are a SALES COACH. Evaluate the rep's opener objectively.\n")}
Behavior:
- Evaluate their opener on: personalization, hook strength, value clarity, and confidence.
- Give a letter grade (A through D) and 2-3 sentences of specific feedback.
- Then provide an improved version of their opener that you'd give an A — using specific details from the brief/company context.
- Keep it tight and actionable.
- Reference what the rep SHOULD mention from the available company intel.

After your evaluation, provide 2-3 alternative opener phrases they could try. Format them as a JSON array:
[SUGGESTIONS]["phrase 1", "phrase 2", "phrase 3"][/SUGGESTIONS]`,
};

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const BriefContextSchema = z
  .object({
    one_sentence_summary: z.string().optional(),
    account_status: z.string().optional(),
    value_pillars: z
      .array(
        z.object({
          pillar: z.string().optional(),
          talking_point: z.string().optional(),
          proof_point: z.string().optional(),
        })
      )
      .optional(),
    objection_playbook: z
      .array(
        z.object({
          objection: z.string().optional(),
          response_framework: z.string().optional(),
        })
      )
      .optional(),
    recommended_slides: z.array(z.object({ slide_number: z.number().optional(), title: z.string().optional(), reason: z.string().optional() })).optional(),
    key_talking_points: z
      .array(
        z.object({
          point: z.string().optional(),
          ask: z.string().optional(),
        })
      )
      .optional(),
  })
  .nullable();

const MessageResponseSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
  model: z.string(),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

export default api({
  name: "PracticeChat",
  description: "Sends chat messages to Claude for pitch practice roleplay",

  integrations: {
    ai: anthropic(ANTHROPIC),
  },

  input: z.object({
    mode: z.enum(["open_call", "objection_drill", "opener_only"]),
    messages: z.array(MessageSchema),
    companyContext: z.string(),
    briefContext: BriefContextSchema.optional(),
  }),

  output: z.object({
    response: z.string(),
    suggestions: z.array(z.string()),
  }),

  async run(ctx, { mode, messages, companyContext, briefContext }) {
    ctx.log.info("Practice chat", { mode, messageCount: messages.length });

    // Build enriched context from brief if available
    let enrichedContext = companyContext;
    if (briefContext) {
      const briefParts: string[] = [];
      if (briefContext.one_sentence_summary) {
        briefParts.push(`Summary: ${briefContext.one_sentence_summary}`);
      }
      if (briefContext.account_status) {
        briefParts.push(`Account Status: ${briefContext.account_status}`);
      }
      if (briefContext.value_pillars?.length) {
        briefParts.push(
          "Value Pillars:\n" +
            briefContext.value_pillars
              .map((v) => `- ${v.pillar}: ${v.talking_point} (Proof: ${v.proof_point})`)
              .join("\n")
        );
      }
      if (briefContext.objection_playbook?.length) {
        briefParts.push(
          "Known Objections & Responses:\n" +
            briefContext.objection_playbook
              .map((o) => `- "${o.objection}" → ${o.response_framework}`)
              .join("\n")
        );
      }
      if (briefContext.key_talking_points?.length) {
        briefParts.push(
          "Key Talking Points:\n" +
            briefContext.key_talking_points
              .map((t) => `- ${t.point}${t.ask ? ` [ASK: ${t.ask}]` : ""}`)
              .join("\n")
        );
      }
      if (briefParts.length > 0) {
        enrichedContext += "\n\n--- PRE-CALL BRIEF CONTEXT ---\n" + briefParts.join("\n\n");
      }
    }

    const systemPrompt = `${SYSTEM_PROMPTS[mode]}

Company context for this roleplay:
${enrichedContext}`;

    const result = await ctx.integrations.ai.apiRequest(
      {
        method: "POST",
        path: "/v1/messages",
        body: {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          system: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        },
      },
      { response: MessageResponseSchema },
      { label: "Practice chat exchange" }
    );

    const rawText = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Extract suggestions from the special block
    let response = rawText;
    let suggestions: string[] = [];

    const sugMatch = rawText.match(/\[SUGGESTIONS\](.*?)\[\/SUGGESTIONS\]/s);
    if (sugMatch) {
      response = rawText.replace(/\[SUGGESTIONS\].*?\[\/SUGGESTIONS\]/s, "").trim();
      try {
        suggestions = JSON.parse(sugMatch[1].trim());
      } catch {
        suggestions = [];
      }
    }

    return { response, suggestions };
  },
});
