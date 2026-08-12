import { api, z, salesforce } from "@superblocksteam/sdk-api";

const SALESFORCE_ID = "7650b0cb-d056-4bf6-912f-a8d4540762a8";

const HistoryRowSchema = z.object({
  snapDate: z.string().nullable(),
  rkoTeam: z.string().nullable(),
  repName: z.string().nullable(),
  dqPct: z.number().nullable(),
  opps: z.number(),
});

export default api({
  name: "GetOpportunityDQHistory",
  description: "Fetches historical DQ snapshots grouped by date, team, and rep.",

  integrations: {
    sf: salesforce(SALESFORCE_ID),
  },

  input: z.object({}),

  output: z.object({
    records: z.array(
      z.object({
        snapDate: z.string(),
        rkoTeam: z.string(),
        repName: z.string(),
        dqPct: z.number(),
        opps: z.number(),
      })
    ),
  }),

  async run(ctx) {
    const soql = `SELECT Snapshot_Date__c snapDate, RKO_Team_Name__c rkoTeam, Rep_Name__c repName,
       AVG(Data_Quality_Score__c) dqPct, COUNT(Id) opps
FROM Opportunity_Data_Quality_History__c
GROUP BY Snapshot_Date__c, RKO_Team_Name__c, Rep_Name__c
ORDER BY Snapshot_Date__c`;

    const results = await ctx.integrations.sf.query(soql, HistoryRowSchema, {
      label: "Fetch DQ history snapshots",
    });

    const records = results
      .filter((r) => r.snapDate && r.rkoTeam && r.repName)
      .map((r) => ({
        snapDate: r.snapDate!,
        rkoTeam: r.rkoTeam!,
        repName: r.repName!,
        dqPct: r.dqPct ?? 0,
        opps: r.opps,
      }));

    return { records };
  },
});
