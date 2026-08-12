import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const SupportHealthEntrySchema = z.object({
  openTickets: z.number(),
  ticketsLastMonth: z.number(),
  ticketsPriorMonth: z.number(),
  momChange: z.number(),
  momChangePct: z.number().nullable(),
  residentIssuePct: z.number(),
  bankChangePct: z.number(),
  totalTickets3mo: z.number(),
  avgCsat: z.number().nullable(),
  topCategory: z.string().nullable(),
});

const RowSchema = z.object({
  PMC_ID: z.string(),
  OPEN_TICKETS: z.coerce.number(),
  TICKETS_LAST_MONTH: z.coerce.number(),
  TICKETS_TWO_MONTHS_AGO: z.coerce.number(),
  RESIDENT_ISSUE_PCT: z.coerce.number().nullable(),
  BANK_CHANGE_PCT: z.coerce.number().nullable(),
  TOTAL_TICKETS_3MO: z.coerce.number(),
  AVG_CSAT: z.coerce.number().nullable(),
  TOP_CATEGORY: z.string().nullable(),
});

export default api({
  name: "GetPMCSupportHealth",
  description: "Queries Zendesk tickets from EXTERNAL_DATA for per-PMC support health metrics.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    pmc_ids_json: z.string(),
  }),

  output: z.object({
    lookup: z.record(z.string(), SupportHealthEntrySchema),
  }),

  async run(ctx, { pmc_ids_json }) {
    const sql = `
WITH ph_tickets AS (
  SELECT
    t.ID                                                              AS ticket_id,
    t.CREATED_AT,
    t.STATUS,
    DATE_TRUNC('MONTH', t.CREATED_AT)                                AS ticket_month,
    MAX(CASE WHEN f.value:id::STRING = '30820966701591'
        THEN f.value:value::STRING END)                              AS pmc_id,
    MAX(CASE WHEN f.value:id::STRING = '30820834556823'
        THEN f.value:value::STRING END)                              AS category
  FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.TICKETS t,
  LATERAL FLATTEN(input => t.CUSTOM_FIELDS) f
  WHERE t.CREATED_AT >= DATEADD(MONTH, -3, DATE_TRUNC('MONTH', CURRENT_DATE()))
  GROUP BY 1, 2, 3, 4
),
csat AS (
  SELECT
    sr.TICKET_ID,
    CASE sr.SCORE
      WHEN 'good' THEN 5
      WHEN 'bad' THEN 1
      ELSE NULL
    END AS SCORE
  FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.SATISFACTION_RATINGS sr
  WHERE sr.SCORE IN ('good', 'bad')
),
ticket_with_csat AS (
  SELECT
    pt.*,
    c.SCORE AS csat_score
  FROM ph_tickets pt
  LEFT JOIN csat c ON pt.ticket_id = c.TICKET_ID
  WHERE pt.pmc_id IS NOT NULL
    AND (
      ARRAY_SIZE(PARSE_JSON(?)) = 0
      OR pt.pmc_id IN (
          SELECT value::STRING
          FROM TABLE(FLATTEN(PARSE_JSON(?)))
      )
    )
)
SELECT
  pmc_id                                                             AS PMC_ID,
  COUNT(CASE WHEN status NOT IN ('closed', 'solved')
        THEN 1 END)                                                  AS OPEN_TICKETS,
  COUNT(CASE WHEN ticket_month = DATE_TRUNC('MONTH',
        DATEADD(MONTH, -1, CURRENT_DATE()))
        THEN 1 END)                                                  AS TICKETS_LAST_MONTH,
  COUNT(CASE WHEN ticket_month = DATE_TRUNC('MONTH',
        DATEADD(MONTH, -2, CURRENT_DATE()))
        THEN 1 END)                                                  AS TICKETS_TWO_MONTHS_AGO,
  COUNT(CASE WHEN category = 'ph_troubleshoot_resident_issue'
        THEN 1 END)::FLOAT
    / NULLIF(COUNT(*), 0)                                            AS RESIDENT_ISSUE_PCT,
  COUNT(CASE WHEN category = 'ph_change_property_bank_account'
        THEN 1 END)::FLOAT
    / NULLIF(COUNT(*), 0)                                            AS BANK_CHANGE_PCT,
  COUNT(*)                                                           AS TOTAL_TICKETS_3MO,
  AVG(csat_score)                                                    AS AVG_CSAT,
  MODE(category)                                                     AS TOP_CATEGORY
FROM ticket_with_csat
GROUP BY pmc_id`;

    const rows = await ctx.integrations.db.query(
      sql,
      RowSchema,
      [pmc_ids_json, pmc_ids_json],
      { label: "Query Zendesk support health by PMC" }
    );

    // Transform into lookup object keyed by PMC ID
    const lookup: Record<string, z.infer<typeof SupportHealthEntrySchema>> = {};
    rows.forEach((row) => {
      const momChange = (row.TICKETS_LAST_MONTH || 0) - (row.TICKETS_TWO_MONTHS_AGO || 0);
      lookup[row.PMC_ID] = {
        openTickets: row.OPEN_TICKETS || 0,
        ticketsLastMonth: row.TICKETS_LAST_MONTH || 0,
        ticketsPriorMonth: row.TICKETS_TWO_MONTHS_AGO || 0,
        momChange,
        momChangePct: row.TICKETS_TWO_MONTHS_AGO && row.TICKETS_TWO_MONTHS_AGO > 0
          ? momChange / row.TICKETS_TWO_MONTHS_AGO
          : null,
        residentIssuePct: row.RESIDENT_ISSUE_PCT || 0,
        bankChangePct: row.BANK_CHANGE_PCT || 0,
        totalTickets3mo: row.TOTAL_TICKETS_3MO || 0,
        avgCsat: row.AVG_CSAT || null,
        topCategory: row.TOP_CATEGORY || null,
      };
    });

    return { lookup };
  },
});
