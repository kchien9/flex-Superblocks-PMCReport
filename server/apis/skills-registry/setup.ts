import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "SetupSkillRegistry",
  description: "Creates SKILL_REGISTRY table and seeds 6 initial skill rows.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  async run(ctx) {
    await ctx.integrations.db.execute(
      `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.SKILL_REGISTRY (
        ID TEXT NOT NULL,
        NAME TEXT NOT NULL,
        DESCRIPTION TEXT,
        SKILL_TYPE TEXT NOT NULL,
        DATA_SOURCE TEXT,
        CODE_OR_QUERY TEXT,
        CONTENT_LIBRARY_DOC TEXT,
        MODULES_USING TEXT,
        OWNER TEXT,
        UPDATED_BY TEXT,
        UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        PRIMARY KEY (ID),
        UNIQUE (NAME)
      )`,
      [],
      { label: "Create skill_registry table" }
    );

    // Check if already seeded
    const existing = await ctx.integrations.db.query(
      `SELECT ID FROM SCRATCH_DATA.SALES.SKILL_REGISTRY LIMIT 1`,
      z.object({ ID: z.string() }),
      [],
      { label: "Check if skills already seeded" }
    );

    if (existing.length > 0) {
      return { success: true, message: "Table exists and skills already seeded." };
    }

    // Seed 6 rows
    const seeds = [
      {
        id: "getFlexRentOpportunities",
        name: "getFlexRentOpportunities",
        description: "Returns open and closed Flex Rent opportunities for current month",
        skill_type: "data",
        data_source: "Salesforce Query",
        code_or_query: "SELECT Account.Name, Owner.Name, CloseDate, Flex_Units__c, StageName FROM Opportunity WHERE CloseDate = THIS_MONTH AND StageName = 'Closed Won' AND RecordType.Name IN ('New Logo/Expansion', 'Deep SMB') AND Type IN ('New Logo', 'Expansion') AND Owner.UserRole.Name LIKE '%Account Executive%' ORDER BY Flex_Units__c DESC",
        content_library_doc: null,
        modules_using: "Leaderboard (planned)",
        owner: "kumbi.murinda@getflex.com",
      },
      {
        id: "lookupAccount",
        name: "lookupAccount",
        description: "Fuzzy account name match against Salesforce with ranked candidates",
        skill_type: "data",
        data_source: "Salesforce Query",
        code_or_query: "Fuzzy match: normalize query → SOQL exact + ILIKE → Levenshtein scoring → optional Claude fallback → return ranked candidates",
        content_library_doc: null,
        modules_using: "Pre-Call Prep (planned)",
        owner: "kumbi.murinda@getflex.com",
      },
      {
        id: "getPSMNARData",
        name: "getPSMNARData",
        description: "Queries Snowflake PROPERTY_BP_MONTH_STATS joined to DIM_SALES_ACCOUNTS — returns PMC × BP_MONTH grain with adoption rate, billing metrics, rollout, and activation data. Accepts PSM email filter and date range parameters.",
        skill_type: "data",
        data_source: "Snowflake Query",
        code_or_query: "SELECT p.PMC_ID, p.PMC_NAME, MAX(s.ACCOUNT_SALESFORCE_ID) AS ACCOUNT_SALESFORCE_ID, MAX(s.PARTNER_SUCCESS_MANAGER_NAME) AS PSM, MAX(s.PARTNER_SUCCESS_MANAGER_EMAIL) AS PSM_EMAIL, MAX(s.ACCOUNT_PROPERTY_MANAGEMENT_SOFTWARES) AS PMS, p.BP_MONTH, COUNT(DISTINCT p.PROPERTY_ID) AS PROPERTY_COUNT, SUM(p.PROPERTY_UNIT_COUNT) AS PROPERTY_UNIT_COUNT, SUM(p.BILLS_PAID_COUNT) AS BILLS_PAID, SUM(p.RENT_PAID_AMOUNT) AS RENT_PAID, SUM(p.BILLS_PAID_COUNT)::FLOAT / NULLIF(SUM(p.PROPERTY_UNIT_COUNT), 0) AS ADOPTION_RATE FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p JOIN PRODUCTION.SALES.DIM_SALES_ACCOUNTS s ON p.PMC_ID = s.PMC_ID WHERE p.IS_ROLLED_OUT = TRUE AND p.BP_MONTH BETWEEN DATEADD(MONTH, -12, DATE_TRUNC('MONTH', CURRENT_DATE())) AND DATEADD(MONTH, 1, DATE_TRUNC('MONTH', CURRENT_DATE())) AND s.PARTNER_SUCCESS_MANAGER_NAME IS NOT NULL GROUP BY p.PMC_ID, p.PMC_NAME, p.BP_MONTH ORDER BY p.PMC_NAME, p.BP_MONTH",
        content_library_doc: null,
        modules_using: "PSM Dashboard",
        owner: "kumbi.murinda@getflex.com",
      },
      {
        id: "getContextDocument",
        name: "getContextDocument",
        description: "Reads a named document from the Content Library table in Snowflake. Used by Intelligence Skills to load playbooks and prompt templates at runtime.",
        skill_type: "data",
        data_source: "Database Read",
        code_or_query: "SELECT * FROM SCRATCH_DATA.SALES.CONTENT_LIBRARY WHERE NAME = :document_name LIMIT 1",
        content_library_doc: null,
        modules_using: "PSM Dashboard, Pre-Call Prep (planned)",
        owner: "kumbi.murinda@getflex.com",
      },
      {
        id: "generateCallBrief",
        name: "generateCallBrief",
        description: "Synthesizes account, opportunity, and conversation data into a structured call prep brief",
        skill_type: "intelligence",
        data_source: "Claude Prompt",
        code_or_query: null,
        content_library_doc: "call_prep_playbook",
        modules_using: "Pre-Call Prep (planned)",
        owner: "kumbi.murinda@getflex.com",
      },
      {
        id: "generatePSMActionItems",
        name: "generatePSMActionItems",
        description: "Calls Claude to generate 3–5 prioritized action items per PMC account based on adoption rate, trend, activation mix, rollout maturity, and portfolio size. Uses PSM playbook logic.",
        skill_type: "intelligence",
        data_source: "Claude Prompt",
        code_or_query: null,
        content_library_doc: "psm_playbook",
        modules_using: "PSM Dashboard",
        owner: "kumbi.murinda@getflex.com",
      },
    ];

    for (const s of seeds) {
      await ctx.integrations.db.execute(
        `INSERT INTO SCRATCH_DATA.SALES.SKILL_REGISTRY (ID, NAME, DESCRIPTION, SKILL_TYPE, DATA_SOURCE, CODE_OR_QUERY, CONTENT_LIBRARY_DOC, MODULES_USING, OWNER, UPDATED_BY, UPDATED_AT)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP())`,
        [s.id, s.name, s.description, s.skill_type, s.data_source, s.code_or_query, s.content_library_doc, s.modules_using, s.owner, s.owner],
        { label: `Seed skill: ${s.name}` }
      );
    }

    return { success: true, message: "Table created and 6 skills seeded successfully." };
  },
});
