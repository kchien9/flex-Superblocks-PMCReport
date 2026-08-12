import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const TicketRowSchema = z.object({
  TICKET_ID: z.coerce.string(),
  CREATED_AT: z.string(),
  STATUS: z.string().nullable(),
  CATEGORY: z.string().nullable(),
  SUBJECT: z.string().nullable(),
  CSAT_SCORE: z.coerce.number().nullable(),
});

const TicketSchema = z.object({
  ticketId: z.string(),
  createdAt: z.string(),
  status: z.string(),
  category: z.string().nullable(),
  subject: z.string().nullable(),
  csatScore: z.number().nullable(),
});

export default api({
  name: "GetPMCTicketList",
  description: "Fetches individual Zendesk tickets for a PMC from Snowflake",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    pmc_id: z.string(),
  }),

  output: z.object({
    tickets: z.array(TicketSchema),
  }),

  async run(ctx, { pmc_id }) {
    const sql = `
WITH ph_tickets AS (
  SELECT
    t.ID                                                   AS ticket_id,
    t.CREATED_AT,
    t.STATUS,
    t.SUBJECT,
    MAX(CASE WHEN f.value:id::STRING = '30820966701591'
        THEN f.value:value::STRING END)                    AS pmc_id,
    MAX(CASE WHEN f.value:id::STRING = '30820834556823'
        THEN f.value:value::STRING END)                    AS category
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
)
SELECT
  pt.ticket_id   AS TICKET_ID,
  pt.CREATED_AT,
  pt.STATUS,
  pt.category    AS CATEGORY,
  pt.SUBJECT,
  c.SCORE        AS CSAT_SCORE
FROM ph_tickets pt
LEFT JOIN csat c ON pt.ticket_id = c.TICKET_ID
WHERE pt.pmc_id = ?
ORDER BY pt.CREATED_AT DESC
LIMIT 200`;

    const rows = await ctx.integrations.db.query(
      sql,
      TicketRowSchema,
      [pmc_id],
      { label: "Fetch Zendesk ticket list for PMC" }
    );

    const tickets = rows.map((r) => ({
      ticketId: r.TICKET_ID,
      createdAt: r.CREATED_AT,
      status: r.STATUS || "unknown",
      category: r.CATEGORY || null,
      subject: r.SUBJECT || null,
      csatScore: r.CSAT_SCORE,
    }));

    return { tickets };
  },
});
