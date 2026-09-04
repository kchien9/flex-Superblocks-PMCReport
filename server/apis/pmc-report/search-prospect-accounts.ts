import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const SF_ACCOUNT = "EXTERNAL_DATA.POLYTOMIC.SALESFORCE_ACCOUNT";
const SF_OPP = "EXTERNAL_DATA.POLYTOMIC.SALESFORCE_OPPORTUNITY";

const ProspectResultSchema = z.object({
  account_id: z.string(),
  account_name: z.string(),
  total_units: z.number(),
  state: z.string(),
  segment: z.string(),
  pms: z.string(),
  portfolio_type: z.string(),
  asset_subtypes: z.array(z.string()),
  opp_stage: z.string(),
  opp_id: z.string(),
});

/**
 * Parse Snowflake's JSON array representation of SFDC multi-select fields.
 * e.g. '["Garden Style","Mid-Rise"]' → ["Garden Style","Mid-Rise"]
 */
function parseSfJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  const s = String(raw).trim();
  const stripped = s.replace(/^\[|\]$/g, "");
  const items = stripped
    .split(",")
    .map((part) => part.replace(/^[\s"]+|[\s"]+$/g, ""))
    .filter(Boolean);
  return items;
}

/**
 * Mapping of common US state names to two-letter codes.
 * Only states that appear in prospect accounts; extend as needed.
 */
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

function normalizeState(raw: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  // Already a 2-letter code?
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const code = STATE_NAME_TO_CODE[trimmed.toLowerCase()];
  return code ?? trimmed.toUpperCase().slice(0, 2);
}

// Raw row from Snowflake query
const RawRowSchema = z.object({
  ACCOUNT_ID: z.string(),
  ACCOUNT_NAME: z.string(),
  TOTAL_UNITS: z.coerce.number().nullable(),
  STATE: z.string().nullable(),
  SEGMENT: z.string().nullable(),
  PORTFOLIO_TYPE: z.string().nullable(),
  ASSET_SUBTYPES: z.string().nullable(),
  PMS: z.string().nullable(),
  OPP_STAGE: z.string().nullable(),
  OPP_ID: z.string().nullable(),
});

export default api({
  name: "SearchProspectAccounts",
  description: "Searches Salesforce Prospect PMC accounts via Snowflake mirror",

  integrations: {
    snowflake_sso: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    query: z.string(),
  }),

  output: z.object({
    results: z.array(ProspectResultSchema),
  }),

  async run(ctx, { query }) {
    const trimmed = query.trim();
    if (!trimmed) {
      return { results: [] };
    }

    const likePattern = `%${trimmed}%`;

    const sql = `
      SELECT
          a.ID                                    AS ACCOUNT_ID,
          a.NAME                                  AS ACCOUNT_NAME,
          a.TOTAL_COMPANY_UNITS__C                AS TOTAL_UNITS,
          a.BILLINGSTATE                          AS STATE,
          a.SALES_SEGMENT__C                      AS SEGMENT,
          o.PORTFOLIO_TYPE__C::STRING             AS PORTFOLIO_TYPE,
          o.PORTFOLIO_ASSET_SUBTYPES__C::STRING   AS ASSET_SUBTYPES,
          o.PM_SOFTWARE__C::STRING                AS PMS,
          o.STAGENAME                             AS OPP_STAGE,
          o.ID                                    AS OPP_ID
      FROM ${SF_ACCOUNT} a
      LEFT JOIN ${SF_OPP} o
          ON o.ACCOUNTID = a.ID
         AND o.ISDELETED = FALSE
         AND o.TYPE = 'New Logo'
      WHERE a.ISDELETED = FALSE
        AND a.ACCOUNT_STATUS__C = 'Prospect'
        AND a.TYPE = 'PMC'
        -- Deep SMB excluded from every account search in this tool (Kevin's call) - this
        -- segment isn't a fit for either report type.
        AND (a.SALES_SEGMENT__C IS NULL OR a.SALES_SEGMENT__C != 'Deep SMB')
        AND UPPER(a.NAME) LIKE UPPER(?)
      QUALIFY ROW_NUMBER() OVER (
          PARTITION BY a.ID
          ORDER BY CASE WHEN o.ISCLOSED = FALSE THEN 0 ELSE 1 END, o.ID DESC
      ) = 1
      ORDER BY a.TOTAL_COMPANY_UNITS__C DESC NULLS LAST
      LIMIT 10
    `;

    const rows = await ctx.integrations.snowflake_sso.query(
      sql,
      RawRowSchema,
      [likePattern],
      { label: "Search prospect accounts" },
    );

    const results = rows.map((row) => {
      const pmsList = parseSfJsonArray(row.PMS);
      const ptList = parseSfJsonArray(row.PORTFOLIO_TYPE);
      const astList = parseSfJsonArray(row.ASSET_SUBTYPES);

      return {
        account_id: row.ACCOUNT_ID,
        account_name: row.ACCOUNT_NAME,
        total_units: row.TOTAL_UNITS ?? 0,
        state: normalizeState(row.STATE),
        segment: row.SEGMENT ?? "SMB",
        pms: pmsList[0] ?? "",
        portfolio_type: ptList[0] ?? "Multi Family",
        asset_subtypes: astList,
        opp_stage: row.OPP_STAGE ?? "",
        opp_id: row.OPP_ID ?? "",
      };
    });

    return { results };
  },
});
