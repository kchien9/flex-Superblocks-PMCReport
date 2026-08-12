import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "SetupOppDQGovernance",
  description: "Creates MODULE_REGISTRY table and registers Opp DQ skills and module",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    created: z.array(z.string()),
  }),

  async run(ctx) {
    const results: string[] = [];

    // 1. Create MODULE_REGISTRY if not exists
    await ctx.integrations.db.execute(
      `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.MODULE_REGISTRY (
        id            STRING DEFAULT UUID_STRING(),
        name          STRING NOT NULL,
        status        STRING NOT NULL,
        description   STRING,
        route         STRING,
        visible_to    STRING,
        created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        updated_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
      )`,
      [],
      { label: "Create MODULE_REGISTRY table" }
    );
    results.push("MODULE_REGISTRY table");

    // 2. Insert module row (upsert-safe via MERGE)
    await ctx.integrations.db.execute(
      `MERGE INTO SCRATCH_DATA.SALES.MODULE_REGISTRY t
       USING (SELECT 'Opportunity Data Quality' AS name) s ON t.name = s.name
       WHEN NOT MATCHED THEN INSERT (name, status, description, route, visible_to)
       VALUES ('Opportunity Data Quality', 'Active',
               'Open pipeline data quality scores by rep and team',
               '/opportunity-data-quality', 'All Roles')`,
      [],
      { label: "Register Opportunity Data Quality module" }
    );
    results.push("Module: Opportunity Data Quality");

    // 3. Register GetOpportunityDQLive skill
    await ctx.integrations.db.execute(
      `MERGE INTO SCRATCH_DATA.SALES.SKILL_REGISTRY t
       USING (SELECT 'GetOpportunityDQLive' AS name) s ON t.name = s.name
       WHEN NOT MATCHED THEN INSERT (id, name, description, skill_type, data_source, code_or_query, modules_using, owner, updated_by)
       VALUES (UUID_STRING(), 'GetOpportunityDQLive',
               'Live per-rep DQ scores from open New Logo/Expansion pipeline (Building Value, Negotiation, Deal Review)',
               'Data', 'Salesforce',
               'SELECT Owner.Name ownerName, Owner.Team_Name__c teamName, Owner.RKO_Team__c rkoTeam, AVG(Data_Quality_Score__c) avgScore, COUNT(Id) opps FROM Opportunity WHERE IsClosed = false AND RecordType.DeveloperName = ''New_Logo'' AND StageName IN (''Building Value'',''Negotiation'',''Deal Review'') AND Owner.IsActive = true AND Owner.RKO_Team__c IN (''Red'',''Blue'',''Green'') GROUP BY Owner.Name, Owner.Team_Name__c, Owner.RKO_Team__c ORDER BY AVG(Data_Quality_Score__c) DESC',
               'Opportunity Data Quality', 'Kumbi', 'Kumbi')`,
      [],
      { label: "Register GetOpportunityDQLive skill" }
    );
    results.push("Skill: GetOpportunityDQLive");

    // 4. Register GetOpportunityDQHistory skill
    await ctx.integrations.db.execute(
      `MERGE INTO SCRATCH_DATA.SALES.SKILL_REGISTRY t
       USING (SELECT 'GetOpportunityDQHistory' AS name) s ON t.name = s.name
       WHEN NOT MATCHED THEN INSERT (id, name, description, skill_type, data_source, code_or_query, modules_using, owner, updated_by)
       VALUES (UUID_STRING(), 'GetOpportunityDQHistory',
               'Weekly DQ snapshot history by rep and RKO team from Opportunity_Data_Quality_History__c',
               'Data', 'Salesforce',
               'SELECT Snapshot_Date__c snapDate, RKO_Team_Name__c rkoTeam, Rep_Name__c repName, AVG(Data_Quality_Score__c) dqPct, COUNT(Id) opps FROM Opportunity_Data_Quality_History__c GROUP BY Snapshot_Date__c, RKO_Team_Name__c, Rep_Name__c ORDER BY Snapshot_Date__c',
               'Opportunity Data Quality', 'Kumbi', 'Kumbi')`,
      [],
      { label: "Register GetOpportunityDQHistory skill" }
    );
    results.push("Skill: GetOpportunityDQHistory");

    return { created: results };
  },
});
