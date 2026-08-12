import { api, z, salesforce, anthropic } from "@superblocksteam/sdk-api";

const SALESFORCE = "7650b0cb-d056-4bf6-912f-a8d4540762a8";
const ANTHROPIC = "0ba6b240-0e7e-4e31-89d5-4ca3dc7d21ff";

// All fields from the reference — includes Bill Pay fields and classification fields
const ACCOUNT_FIELDS = [
  "Id", "Name", "Website", "Phone",
  "BillingCity", "BillingState", "BillingCountry",
  "PM_Software__c", "Total_Company_Units__c",
  "Sales_Segment__c", "Account_Status__c",
  "Total_Units_on_Flex__c",
  "Asset_Class__c", "Portfolio_Type__c", "Portfolio_Asset_Subtypes__c",
  "Flex_Company_ID__c",
  // Bill Pay fields
  "Last_Bill_Pay_Charged_Users__c", "Last_Bill_Pay_NAR__c",
  "Last_Bill_Pay_TNAR__c", "Rent_Paid_Last_BP__c",
  "Bills_Paid_Last_BP__c", "Total_of_Bill_Pay_Users__c",
  // Owner relationship
  "Owner.Name",
].join(", ");

const AccountSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Website: z.string().nullable(),
  Phone: z.string().nullable(),
  BillingCity: z.string().nullable(),
  BillingState: z.string().nullable(),
  BillingCountry: z.string().nullable(),
  PM_Software__c: z.string().nullable(),
  Total_Company_Units__c: z.number().nullable(),
  Sales_Segment__c: z.string().nullable(),
  Account_Status__c: z.string().nullable(),
  Total_Units_on_Flex__c: z.number().nullable(),
  Asset_Class__c: z.string().nullable(),
  Portfolio_Type__c: z.string().nullable(),
  Portfolio_Asset_Subtypes__c: z.string().nullable(),
  Flex_Company_ID__c: z.string().nullable(),
  Last_Bill_Pay_Charged_Users__c: z.number().nullable(),
  Last_Bill_Pay_NAR__c: z.number().nullable(),
  Last_Bill_Pay_TNAR__c: z.number().nullable(),
  Rent_Paid_Last_BP__c: z.number().nullable(),
  Bills_Paid_Last_BP__c: z.number().nullable(),
  Total_of_Bill_Pay_Users__c: z.number().nullable(),
  Owner: z.object({ Name: z.string() }).nullable(),
});

// Salesforce Activities schema
const ActivitySchema = z.object({
  Id: z.string(),
  Subject: z.string().nullable(),
  Status: z.string().nullable(),
  ActivityDate: z.string().nullable(),
  Description: z.string().nullable(),
  Type: z.string().nullable(),
  Who: z.object({ Name: z.string() }).nullable(),
});

// Opportunity schema
const OpportunitySchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Amount: z.number().nullable(),
  StageName: z.string().nullable(),
  CloseDate: z.string().nullable(),
  Type: z.string().nullable(),
  NextStep: z.string().nullable(),
});

// Closed-Lost Opportunity schema
const ClosedLostOppSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Amount: z.number().nullable(),
  CloseDate: z.string().nullable(),
  Loss_Reason__c: z.string().nullable(),
  StageName: z.string().nullable(),
  Description: z.string().nullable(),
});

// Contact Role schema
const ContactRoleSchema = z.object({
  Id: z.string(),
  Role: z.string().nullable(),
  IsPrimary: z.boolean().nullable(),
  Contact: z.object({
    Name: z.string(),
    Title: z.string().nullable(),
  }).nullable(),
});

const NormResponseSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  model: z.string(),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

// Important SF fields for data gap detection
const IMPORTANT_FIELDS = [
  "PM_Software__c", "Total_Company_Units__c", "Asset_Class__c",
  "Portfolio_Type__c", "Sales_Segment__c", "BillingCity", "BillingState",
  "Website", "Phone",
];

export default api({
  name: "SearchSalesforceAccounts",
  description: "3-pass SF search with normalization, activities, opps, closed-lost, data gaps",

  integrations: {
    sf: salesforce(SALESFORCE),
    ai: anthropic(ANTHROPIC),
  },

  input: z.object({
    companyName: z.string(),
    // When an account ID is provided, also fetch enrichment data
    accountId: z.string().nullable().optional(),
  }),

  output: z.object({
    accounts: z.array(AccountSchema),
    // Enrichment data (only populated when accountId is provided)
    activities: z.array(z.record(z.any())).optional(),
    openOpportunities: z.array(z.record(z.any())).optional(),
    closedLostOpportunities: z.array(z.record(z.any())).optional(),
    dataGaps: z.array(z.string()).optional(),
  }),

  async run(ctx, { companyName, accountId }) {
    const sanitized = companyName.replace(/'/g, "\\'").trim();

    if (sanitized.length < 2) {
      return { accounts: [] };
    }

    // Step 1: AI normalization for single-word abbreviations
    let normalized = sanitized;
    if (sanitized.split(/\s+/).length === 1) {
      try {
        const normResult = await ctx.integrations.ai.apiRequest(
          {
            method: "POST",
            path: "/v1/messages",
            body: {
              model: "claude-haiku-4-5-20251001",
              max_tokens: 50,
              system:
                "You are a search query normalizer for a property management CRM. Fix typos and expand common abbreviations into full company names. Output ONLY the corrected company name — nothing else, no quotes, no punctuation, no explanation. Examples: 'cushwake' → 'Cushman Wakefield', 'jll' → 'JLL', 'grestar' → 'Greystar', 'brok field' → 'Brookfield', 'CBRE' → 'CBRE', 'eq resi' → 'Equity Residential', 'avalonbay' → 'AvalonBay Communities'. If the input looks correct already, return it unchanged.",
              messages: [{ role: "user", content: sanitized }],
            },
          },
          { response: NormResponseSchema },
          { label: "Normalize search query" }
        );

        const normText = normResult.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("")
          .trim();
        if (normText && normText.length > 0) {
          normalized = normText.replace(/'/g, "\\'");
        }
      } catch {
        // Fall back to original sanitized input if normalization fails
      }
    }

    // Use both normalized and original (if different) for maximum recall
    const searchTerms = [normalized];
    if (normalized.toLowerCase() !== sanitized.toLowerCase()) {
      searchTerms.push(sanitized);
    }

    const allResults: z.infer<typeof AccountSchema>[] = [];

    for (const term of searchTerms) {
      // Pass 1: Exact match
      try {
        const exactResults = await ctx.integrations.sf.query(
          `SELECT ${ACCOUNT_FIELDS} FROM Account WHERE Name = '${term}' LIMIT 10`,
          AccountSchema,
          { label: `Exact match: ${term}` }
        );
        allResults.push(...exactResults);
      } catch { /* continue */ }

      // Pass 2: LIKE substring match
      try {
        const likeResults = await ctx.integrations.sf.query(
          `SELECT ${ACCOUNT_FIELDS} FROM Account WHERE Name LIKE '%${term}%' LIMIT 10`,
          AccountSchema,
          { label: `LIKE match: ${term}` }
        );
        allResults.push(...likeResults);
      } catch { /* continue */ }

      // Pass 3: SOSL search (finds partial/fuzzy matches)
      try {
        // Escape SOSL special chars
        const soslSafe = term.replace(/[?&|!{}[\]()^~*:\\"+\-']/g, "\\$&");
        const soslResults = await ctx.integrations.sf.query(
          `FIND {${soslSafe}} IN NAME FIELDS RETURNING Account(${ACCOUNT_FIELDS}) LIMIT 10`,
          AccountSchema,
          { label: `SOSL search: ${term}` }
        );
        allResults.push(...soslResults);
      } catch {
        // SOSL may not be supported via this integration — fall back to prefix match
        try {
          const prefix = term.slice(0, Math.max(4, Math.ceil(term.length * 0.7)));
          if (prefix !== term) {
            const prefixResults = await ctx.integrations.sf.query(
              `SELECT ${ACCOUNT_FIELDS} FROM Account WHERE Name LIKE '${prefix.replace(/'/g, "\\'")}%' LIMIT 10`,
              AccountSchema,
              { label: `Prefix fallback: ${term}` }
            );
            allResults.push(...prefixResults);
          }
        } catch { /* continue */ }
      }
    }

    // Deduplicate by Id, preserving order (normalized matches first)
    const seen = new Set<string>();
    const combined: z.infer<typeof AccountSchema>[] = [];
    for (const account of allResults) {
      if (!seen.has(account.Id)) {
        seen.add(account.Id);
        combined.push(account);
      }
    }

    const accounts = combined.slice(0, 15);

    // === Enrichment: if accountId is provided, fetch activities, opps, closed-lost ===
    let activities: Record<string, any>[] | undefined;
    let openOpportunities: Record<string, any>[] | undefined;
    let closedLostOpportunities: Record<string, any>[] | undefined;
    let dataGaps: string[] | undefined;

    if (accountId) {
      // Compute data gaps from the first matching account or the provided one
      const targetAccount = accounts.find((a) => a.Id === accountId) ?? accounts[0];
      if (targetAccount) {
        dataGaps = IMPORTANT_FIELDS.filter((field) => {
          const val = (targetAccount as any)[field];
          return val === null || val === undefined || val === "";
        });
      }

      // Fetch recent activities (180 days)
      try {
        const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const actResults = await ctx.integrations.sf.query(
          `SELECT Id, Subject, Status, ActivityDate, Description, Type, Who.Name FROM Task WHERE AccountId = '${accountId}' AND ActivityDate >= ${cutoff} ORDER BY ActivityDate DESC LIMIT 20`,
          ActivitySchema,
          { label: "Recent Activities (Tasks)" }
        );
        activities = actResults as any[];

        // Also fetch events
        try {
          const eventResults = await ctx.integrations.sf.query(
            `SELECT Id, Subject, StartDateTime, Description, Type, Who.Name FROM Event WHERE AccountId = '${accountId}' AND StartDateTime >= ${cutoff}T00:00:00Z ORDER BY StartDateTime DESC LIMIT 10`,
            z.object({
              Id: z.string(),
              Subject: z.string().nullable(),
              StartDateTime: z.string().nullable(),
              Description: z.string().nullable(),
              Type: z.string().nullable(),
              Who: z.object({ Name: z.string() }).nullable(),
            }),
            { label: "Recent Activities (Events)" }
          );
          activities = [...(activities || []), ...eventResults.map((e) => ({
            ...e, ActivityDate: e.StartDateTime, Status: "Completed",
          }))];
        } catch { /* events query optional */ }
      } catch {
        activities = [];
      }

      // Fetch open opportunities (New Logo / Expansion)
      try {
        const oppResults = await ctx.integrations.sf.query(
          `SELECT Id, Name, Amount, StageName, CloseDate, Type, NextStep FROM Opportunity WHERE AccountId = '${accountId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 10`,
          OpportunitySchema,
          { label: "Open Opportunities" }
        );
        openOpportunities = oppResults as any[];
      } catch {
        openOpportunities = [];
      }

      // Fetch closed-lost opportunities with contact roles
      try {
        const clResults = await ctx.integrations.sf.query(
          `SELECT Id, Name, Amount, CloseDate, Loss_Reason__c, StageName, Description FROM Opportunity WHERE AccountId = '${accountId}' AND StageName = 'Closed Lost' ORDER BY CloseDate DESC LIMIT 10`,
          ClosedLostOppSchema,
          { label: "Closed-Lost Opportunities" }
        );

        // Fetch contact roles for closed-lost opps
        const enrichedClosedLost: Record<string, any>[] = [];
        for (const opp of clResults.slice(0, 5)) {
          let contactRoles: any[] = [];
          try {
            contactRoles = await ctx.integrations.sf.query(
              `SELECT Id, Role, IsPrimary, Contact.Name, Contact.Title FROM OpportunityContactRole WHERE OpportunityId = '${opp.Id}' LIMIT 10`,
              ContactRoleSchema,
              { label: `Contact roles for ${opp.Name}` }
            );
          } catch { /* optional */ }
          enrichedClosedLost.push({
            ...opp,
            contact_roles: contactRoles.map((cr) => ({
              name: cr.Contact?.Name ?? "Unknown",
              title: cr.Contact?.Title ?? null,
              role: cr.Role,
              is_primary: cr.IsPrimary,
            })),
          });
        }
        closedLostOpportunities = enrichedClosedLost;
      } catch {
        closedLostOpportunities = [];
      }
    }

    return {
      accounts,
      activities,
      openOpportunities,
      closedLostOpportunities,
      dataGaps,
    };
  },
});
