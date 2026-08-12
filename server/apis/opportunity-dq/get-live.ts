import { api, z, salesforce } from "@superblocksteam/sdk-api";

const SALESFORCE_ID = "7650b0cb-d056-4bf6-912f-a8d4540762a8";

const AggregateRowSchema = z.object({
  ownerName: z.string(),
  teamName: z.string().nullable(),
  rkoTeam: z.string().nullable(),
  avgScore: z.number().nullable(),
  opps: z.number(),
});

export default api({
  name: "GetOpportunityDQLive",
  description: "Queries open pipeline DQ scores grouped by rep from Salesforce.",

  integrations: {
    sf: salesforce(SALESFORCE_ID),
  },

  input: z.object({}),

  output: z.object({
    records: z.array(
      z.object({
        ownerName: z.string(),
        teamName: z.string(),
        rkoTeam: z.string(),
        opps: z.number(),
        repDQ: z.number(),
      })
    ),
  }),

  async run(ctx) {
    const soql = `SELECT Owner.Name ownerName, Owner.Team_Name__c teamName, Owner.RKO_Team__c rkoTeam,
       AVG(Data_Quality_Score__c) avgScore, COUNT(Id) opps
FROM Opportunity
WHERE IsClosed = false
  AND RecordType.DeveloperName = 'New_Logo'
  AND StageName IN ('Building Value','Negotiation','Deal Review')
  AND Owner.IsActive = true
  AND Owner.RKO_Team__c IN ('Red','Blue','Green')
GROUP BY Owner.Name, Owner.Team_Name__c, Owner.RKO_Team__c
ORDER BY AVG(Data_Quality_Score__c) DESC`;

    const results = await ctx.integrations.sf.query(soql, AggregateRowSchema, {
      label: "Fetch opportunity DQ scores by rep",
    });

    const records = results.map((r) => ({
      ownerName: r.ownerName,
      teamName: r.teamName || "Unassigned",
      rkoTeam: r.rkoTeam || "Unknown",
      opps: r.opps,
      repDQ: Math.round(((r.avgScore || 0) / 5) * 1000) / 10,
    }));

    return { records };
  },
});
