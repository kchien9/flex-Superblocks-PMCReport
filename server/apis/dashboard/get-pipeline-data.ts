import { api, z, salesforce } from "@superblocksteam/sdk-api";

const SALESFORCE_ID = "7650b0cb-d056-4bf6-912f-a8d4540762a8";

const StageRowSchema = z.object({
  StageName: z.string(),
  Units: z.number().nullable(),
});

const ClosedWonRowSchema = z.object({
  Account: z.object({ Name: z.string() }).nullable(),
  Flex_Units__c: z.number().nullable(),
  CloseDate: z.string(),
  Owner: z.object({ Name: z.string() }),
});

export default api({
  name: "GetDashboardPipelineData",
  description: "Fetches pipeline by stage and recent closed won from Salesforce",

  integrations: {
    sf: salesforce(SALESFORCE_ID),
  },

  input: z.object({}),

  output: z.object({
    stages: z.array(z.object({
      name: z.string(),
      units: z.number(),
    })),
    recentClosedWon: z.array(z.object({
      accountName: z.string(),
      units: z.number(),
      closeDate: z.string(),
      ownerName: z.string(),
    })),
    totalPipelineUnits: z.number(),
  }),

  async run(ctx) {
    // Run both queries in parallel
    const [stageResults, closedWonResults] = await Promise.all([
      ctx.integrations.sf.query(
        `SELECT StageName, SUM(Flex_Units__c) Units
         FROM Opportunity
         WHERE IsClosed = false
           AND Test_Record__c = false
           AND CloseDate = THIS_QUARTER
           AND RecordType.Name IN ('New Logo/Expansion', 'Deep SMB')
           AND Type IN ('New Logo', 'Expansion')
         GROUP BY StageName
         ORDER BY SUM(Flex_Units__c) DESC`,
        StageRowSchema,
        { label: "Pipeline by stage" }
      ),
      ctx.integrations.sf.query(
        `SELECT Account.Name, Flex_Units__c, CloseDate, Owner.Name
         FROM Opportunity
         WHERE StageName = 'Closed Won'
           AND Test_Record__c = false
           AND CloseDate = LAST_N_DAYS:30
           AND RecordType.Name IN ('New Logo/Expansion', 'Deep SMB')
           AND Type IN ('New Logo', 'Expansion')
         ORDER BY CloseDate DESC
         LIMIT 10`,
        ClosedWonRowSchema,
        { label: "Recent closed won deals" }
      ),
    ]);

    const stages = stageResults.map((r) => ({
      name: r.StageName,
      units: r.Units || 0,
    }));

    const totalPipelineUnits = stages.reduce((sum, s) => sum + s.units, 0);

    const recentClosedWon = closedWonResults.map((r) => ({
      accountName: r.Account?.Name || "Unknown",
      units: r.Flex_Units__c || 0,
      closeDate: r.CloseDate,
      ownerName: r.Owner.Name,
    }));

    return { stages, recentClosedWon, totalPipelineUnits };
  },
});
