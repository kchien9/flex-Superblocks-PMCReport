import { api, z, salesforce } from "@superblocksteam/sdk-api";

const SALESFORCE_ID = "7650b0cb-d056-4bf6-912f-a8d4540762a8";

const OpportunitySchema = z.object({
  Account: z.object({ Name: z.string() }).nullable(),
  Owner: z.object({
    Name: z.string(),
    Email: z.string(),
    Team_Name__c: z.string().nullable(),
  }),
  CloseDate: z.string(),
  Flex_Units__c: z.number().nullable(),
  StageName: z.string(),
});

const PERIOD_FILTERS: Record<string, string> = {
  "This Month": "CloseDate = THIS_MONTH",
  "Last Month": "CloseDate = LAST_MONTH",
  "This Quarter": "CloseDate = THIS_QUARTER",
};

export default api({
  name: "GetLeaderboardPipeline",
  description: "Fetches open pipeline opportunities from Salesforce for leaderboard",

  integrations: {
    sf: salesforce(SALESFORCE_ID),
  },

  input: z.object({
    period: z.string(),
  }),

  output: z.object({
    opportunities: z.array(z.object({
      accountName: z.string(),
      ownerName: z.string(),
      ownerEmail: z.string(),
      teamName: z.string(),
      flexUnits: z.number(),
      closeDate: z.string(),
      stageName: z.string(),
    })),
  }),

  async run(ctx, { period }) {
    const dateFilter = PERIOD_FILTERS[period] || "CloseDate = THIS_MONTH";

    const soql = `SELECT Account.Name, Owner.Name, Owner.Email, CloseDate, Flex_Units__c, StageName, Owner.Team_Name__c FROM Opportunity WHERE IsClosed = false AND Test_Record__c = false AND ${dateFilter} AND RecordType.Name IN ('New Logo/Expansion', 'Deep SMB') AND Type IN ('New Logo', 'Expansion') AND (Owner.UserRole.Name LIKE '%Account Executive%' OR Owner.UserRole.Name LIKE '%Sales Manager%') ORDER BY Flex_Units__c DESC NULLS LAST LIMIT 500`;

    const results = await ctx.integrations.sf.query(soql, OpportunitySchema, {
      label: "Fetch pipeline opps for leaderboard",
    });

    const opportunities = results.map((r) => ({
      accountName: r.Account?.Name || "Unknown",
      ownerName: r.Owner.Name,
      ownerEmail: r.Owner.Email,
      teamName: r.Owner.Team_Name__c || "Unassigned",
      flexUnits: r.Flex_Units__c || 0,
      closeDate: r.CloseDate,
      stageName: r.StageName,
    }));

    return { opportunities };
  },
});
