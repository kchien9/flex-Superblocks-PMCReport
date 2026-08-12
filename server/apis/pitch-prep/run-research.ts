import { api, z, anthropic } from "@superblocksteam/sdk-api";

const ANTHROPIC = "0ba6b240-0e7e-4e31-89d5-4ca3dc7d21ff";

const AccountInputSchema = z.object({
  Name: z.string(),
  Website: z.string().nullable(),
  BillingCity: z.string().nullable(),
  BillingState: z.string().nullable(),
  BillingCountry: z.string().nullable().optional(),
  Total_Company_Units__c: z.number().nullable(),
  PM_Software__c: z.string().nullable(),
  Account_Status__c: z.string().nullable(),
  Total_Units_on_Flex__c: z.number().nullable(),
  Sales_Segment__c: z.string().nullable(),
  Asset_Class__c: z.string().nullable().optional(),
  Portfolio_Type__c: z.string().nullable().optional(),
  Portfolio_Asset_Subtypes__c: z.string().nullable().optional(),
  // Bill Pay fields
  Last_Bill_Pay_Charged_Users__c: z.number().nullable().optional(),
  Last_Bill_Pay_NAR__c: z.number().nullable().optional(),
  Last_Bill_Pay_TNAR__c: z.number().nullable().optional(),
  Rent_Paid_Last_BP__c: z.number().nullable().optional(),
  Bills_Paid_Last_BP__c: z.number().nullable().optional(),
  Total_of_Bill_Pay_Users__c: z.number().nullable().optional(),
});

const DealContextInputSchema = z.object({
  attendees: z.string(),
  buyerPersonas: z.array(z.string()),
  focusAreas: z.array(z.string()),
  knownConcerns: z.string(),
  marketFocus: z.string(),
  additionalNotes: z.string(),
});

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

const RESEARCH_SYSTEM = `You are a B2B sales intelligence researcher for Flex, a flexible rent payment platform for property management companies.
Your job is to research property management companies and return structured JSON.
Always search the web for recent news, current information, and anything that gives a rep an edge.

Return ONLY valid JSON matching this schema:
{
  "company_name": string,
  "hq_location": string,
  "units_managed": string or number,
  "pm_software": string,
  "asset_class": string (e.g. "Conventional Multifamily", "Student Housing", "Affordable"),
  "business_model": string (e.g. "3rd Party Manager", "Owner/Operator", "REIT"),
  "portfolio_type": string (e.g. "Mixed", "Multifamily", "Single Family Rental"),
  "housing_types": [string] (e.g. ["Garden-style", "Mid-rise", "High-rise"]),
  "markets_operated": [string],
  "recent_news": [{"headline": string, "summary": string, "source_url": string}],
  "market_headwinds": [{"headline": string, "summary": string}],
  "pain_points": [{"point": string, "detail": string (1-2 sentences explaining why this matters to this specific PMC), "source": string (where you found this — e.g. "Company website", "Industry report", "Earnings call", "News article")}],
  "company_website_notes": string,
  "contacts": [{"name": string, "title": string, "background": string, "linkedin_url": string, "prep_note": string}],
  "relationship_summary": string (narrative about Flex's existing relationship with this account based on activities/opportunities),
  "open_opportunity": {"name": string, "amount": number, "stage": string, "next_steps": string} or null,
  "closed_lost_history": {"deals": [{"name": string, "amount": number, "close_date": string, "loss_reason": string, "contacts": [string]}], "pattern_analysis": string, "prior_contacts_overlap": [string]} or null,
  "summary": string
}

RULES:
- If attendees are listed, search for each on LinkedIn and populate the contacts array.
- The "market_headwinds" field is for MACRO market/regulatory headwinds affecting the company.
- The "pain_points" field should be specific to THIS company — explain why each pain point is real for them and cite where you got the information (their website, news, industry data, SF data, etc.). 5-8 pain points.
- The "relationship_summary" should synthesize recent activities and open opportunities into a narrative.
- For closed_lost_history, analyze loss reasons for patterns and identify if any prior contacts overlap with current attendees.
- Always try to visit the company's website for "company_website_notes".`;

export default api({
  name: "RunResearch",
  description: "Claude research with SF activities, opps, closed-lost, attendee lookup",

  integrations: {
    ai: anthropic(ANTHROPIC),
  },

  input: z.object({
    account: AccountInputSchema,
    dealContext: DealContextInputSchema,
    // New: enrichment data from SF
    sfActivities: z.array(z.record(z.any())).nullable().optional(),
    sfOpenOpportunities: z.array(z.record(z.any())).nullable().optional(),
    sfClosedLost: z.array(z.record(z.any())).nullable().optional(),
    sfDataGaps: z.array(z.string()).nullable().optional(),
  }),

  output: z.object({
    research: z.record(z.any()),
    rawText: z.string(),
    dataGaps: z.array(z.string()).optional(),
  }),

  async run(ctx, { account, dealContext, sfActivities, sfOpenOpportunities, sfClosedLost, sfDataGaps }) {
    ctx.log.info("Running research for account", { name: account.Name });

    // Build SF context block
    let sfContext = `\nSalesforce data:
- Company: ${account.Name}
- Website: ${account.Website ?? "N/A"}
- HQ: ${account.BillingCity ?? "Unknown"}, ${account.BillingState ?? "Unknown"}${account.BillingCountry ? `, ${account.BillingCountry}` : ""}
- Total Units: ${account.Total_Company_Units__c ?? "Unknown"}
- PMS: ${account.PM_Software__c ?? "Unknown"}
- Account Status: ${account.Account_Status__c ?? "Unknown"}
- Units on Flex: ${account.Total_Units_on_Flex__c ?? 0}
- Segment: ${account.Sales_Segment__c ?? "Unknown"}
- Asset Class: ${account.Asset_Class__c ?? "Unknown"}
- Portfolio Type: ${account.Portfolio_Type__c ?? "Unknown"}
- Housing Subtypes: ${account.Portfolio_Asset_Subtypes__c ?? "Unknown"}`;

    // Bill Pay context
    let bpContext = "";
    if (account.Total_of_Bill_Pay_Users__c || account.Last_Bill_Pay_NAR__c) {
      bpContext = `\n\nEXISTING FLEX BILL PAY DATA (this account is already a Flex Bill Pay partner):
- Total Bill Pay Users: ${account.Total_of_Bill_Pay_Users__c ?? "N/A"}
- Last Bill Pay Charged Users: ${account.Last_Bill_Pay_Charged_Users__c ?? "N/A"}
- Bill Pay NAR: ${account.Last_Bill_Pay_NAR__c ?? "N/A"}
- Bill Pay TNAR: ${account.Last_Bill_Pay_TNAR__c ?? "N/A"}
- Rent Paid Last BP: ${account.Rent_Paid_Last_BP__c ?? "N/A"}
- Bills Paid Last BP: ${account.Bills_Paid_Last_BP__c ?? "N/A"}
Note: This means Flex already has a relationship with this account. Factor this into the relationship_summary.`;
    }

    // Activities context
    let activitiesContext = "";
    if (sfActivities && sfActivities.length > 0) {
      const actLines = sfActivities.slice(0, 15).map((a) => {
        const date = a.ActivityDate ? ` (${a.ActivityDate})` : "";
        const who = a.Who?.Name ? ` with ${a.Who.Name}` : "";
        return `  - ${a.Subject || a.Type || "Activity"}${date}${who}${a.Status ? ` [${a.Status}]` : ""}`;
      });
      activitiesContext = `\n\nRECENT SALESFORCE ACTIVITIES (${sfActivities.length} found, last 180 days):\n${actLines.join("\n")}
\nUse these to populate the 'relationship_summary' field with context about Flex's recent engagement with this account.`;
    }

    // Open opportunity context
    let opportunityContext = "";
    if (sfOpenOpportunities && sfOpenOpportunities.length > 0) {
      const oppLines = sfOpenOpportunities.map((o) =>
        `  - ${o.Name}: $${o.Amount ?? "?"} | Stage: ${o.StageName ?? "?"} | Close: ${o.CloseDate ?? "?"} | Next: ${o.NextStep ?? "N/A"}`
      );
      opportunityContext = `\n\nOPEN OPPORTUNITIES (${sfOpenOpportunities.length} found):\n${oppLines.join("\n")}
\nPopulate the 'open_opportunity' field with the most relevant/largest open opportunity.`;
    }

    // Closed-lost context
    let closedLostContext = "";
    if (sfClosedLost && sfClosedLost.length > 0) {
      const clLines = sfClosedLost.map((o) => {
        let entry = `  - ${o.Name}: $${o.Amount ?? "?"} | Closed: ${o.CloseDate ?? "?"} | Reason: ${o.Loss_Reason__c ?? "Unknown"}`;
        if (o.contact_roles && o.contact_roles.length > 0) {
          const contacts = o.contact_roles.map((cr: any) => {
            let cs = cr.name || "Unknown";
            if (cr.title) cs += ` (${cr.title})`;
            if (cr.role) cs += ` — ${cr.role}`;
            if (cr.is_primary) cs += " [Primary]";
            return cs;
          });
          entry += `\n    Contacts: ${contacts.join("; ")}`;
        }
        if (o.Description) entry += `\n    Notes: ${o.Description.slice(0, 200)}`;
        return entry;
      });
      closedLostContext = `\n\nCLOSED-LOST OPPORTUNITY HISTORY (${sfClosedLost.length} found, newest first):\n${clLines.join("\n\n")}
\nPopulate the 'closed_lost_history' field. Compare stated loss reasons against the discovery notes. For 'prior_contacts_overlap', only include people who appear in BOTH the prior deal contacts AND the current call attendees.`;
    }

    // Deal context section
    const dealContextSection = `\n\nDEAL CONTEXT:
- Personas in the room: ${dealContext.buyerPersonas.join(", ") || "Not specified"}
- Focus areas: ${dealContext.focusAreas.join(", ") || "Not specified"}
- Known concerns: ${dealContext.knownConcerns || "None"}
- Market focus: ${dealContext.marketFocus}
- Notes: ${dealContext.additionalNotes || "None"}`;

    // Attendees section (triggers LinkedIn lookup)
    let attendeesSection = "";
    const attendeeNames = dealContext.attendees
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    if (attendeeNames.length > 0) {
      attendeesSection = `\n\nATTENDEES ON THIS CALL — use web search to find each person's LinkedIn profile, job title, and background:\n${attendeeNames.map((n) => `  - ${n}`).join("\n")}`;
    }

    const userPrompt = `Research the property management company: ${account.Name}${sfContext}${bpContext}${activitiesContext}${opportunityContext}${closedLostContext}${dealContextSection}${attendeesSection}

Use web search to fill in any gaps not covered by the Salesforce data above. Also visit the company's website for company_website_notes. If attendees are listed, search for each on LinkedIn. Return your findings as a JSON object matching the schema in your instructions.`;

    const result = await ctx.integrations.ai.apiRequest(
      {
        method: "POST",
        path: "/v1/messages",
        body: {
          model: "claude-sonnet-4-6",
          max_tokens: 5000,
          system: RESEARCH_SYSTEM,
          messages: [{ role: "user", content: userPrompt }],
        },
      },
      { response: MessageResponseSchema },
      { label: "Claude research call" }
    );

    const rawText = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Parse the JSON from Claude's response
    let research: Record<string, any>;
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
      // Extract first JSON object using bracket-depth tracking
      const start = cleaned.indexOf("{");
      if (start === -1) throw new Error("No JSON found");
      let depth = 0;
      let end = -1;
      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === "{") depth++;
        else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end === -1) throw new Error("Unclosed JSON object");
      research = JSON.parse(cleaned.slice(start, end));
    } catch {
      throw new Error(
        "Failed to parse research response as JSON. The AI returned an invalid response. Please try again."
      );
    }

    // Normalize fields
    if (!Array.isArray(research.recent_news)) {
      research.recent_news = research.recent_news ? [{ headline: "Recent News", summary: String(research.recent_news) }] : [];
    }
    if (!Array.isArray(research.market_headwinds)) {
      research.market_headwinds = research.market_headwinds ? [{ headline: "Market Headwinds", summary: String(research.market_headwinds) }] : [];
    }
    if (!Array.isArray(research.markets_operated)) {
      research.markets_operated = [];
    }
    if (!Array.isArray(research.housing_types)) {
      research.housing_types = [];
    }
    if (!Array.isArray(research.contacts)) {
      research.contacts = [];
    }
    if (!Array.isArray(research.pain_points)) {
      // Derive pain_points from headwinds if not present
      const headwinds = research.market_headwinds || [];
      research.pain_points = headwinds.map((h: any) => ({
        point: h.headline || "",
        detail: h.summary || "",
        source: "Market research",
      })).filter((p: any) => p.point);
    }

    // Inject SF override fields
    if (account.Total_Company_Units__c) {
      research.units_managed = account.Total_Company_Units__c;
    }
    if (account.PM_Software__c) {
      research.pm_software = account.PM_Software__c;
    }
    if (account.Asset_Class__c) {
      research.asset_class = account.Asset_Class__c;
    }
    if (account.Portfolio_Type__c) {
      research.business_model = account.Portfolio_Type__c;
    }
    if (account.Portfolio_Asset_Subtypes__c) {
      research.housing_types = account.Portfolio_Asset_Subtypes__c.split(";").map((s: string) => s.trim()).filter(Boolean);
    }
    if (account.BillingCity && account.BillingState) {
      research.hq_location = `${account.BillingCity}, ${account.BillingState}`;
    }
    if (account.Account_Status__c) {
      research.account_status = account.Account_Status__c;
    }

    // Bill Pay data injected directly into research
    if (account.Total_of_Bill_Pay_Users__c || account.Last_Bill_Pay_NAR__c) {
      research.bill_pay = {
        total_users: account.Total_of_Bill_Pay_Users__c,
        charged_users: account.Last_Bill_Pay_Charged_Users__c,
        nar: account.Last_Bill_Pay_NAR__c,
        tnar: account.Last_Bill_Pay_TNAR__c,
        rent_paid: account.Rent_Paid_Last_BP__c,
        bills_paid: account.Bills_Paid_Last_BP__c,
      };
    }

    return { research, rawText, dataGaps: sfDataGaps ?? [] };
  },
});
