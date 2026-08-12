import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const POSITIVE_SIGNALS = [
  "love", "amazing", "excellent", "fantastic", "wonderful", "great",
  "helpful", "easy", "flexible", "convenient", "perfect", "awesome",
  "best", "life changing", "life-changing", "stress-free", "stress free",
  "smooth", "seamless", "highly recommend", "game changer", "game-changer",
  "thank you", "thankful", "grateful", "appreciate", "saved", "simple",
  "quick", "fast", "reliable", "professional", "outstanding", "incredible",
  "brilliant", "superb", "phenomenal", "exceptional", "blown away",
  "couldn't be happier", "could not be happier",
];

function sentimentScore(text: string): number {
  const t = text.toLowerCase();
  let score = POSITIVE_SIGNALS.filter((w) => t.includes(w)).length;
  score += (text.match(/!/g) || []).length;
  score += text.length > 150 ? 1 : 0;
  return score;
}

function anonymizeName(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  return parts[0] || "Resident";
}

const TestimonialRowSchema = z.object({
  COMMENT: z.string(),
  RESIDENT_NAME: z.string().nullable(),
  PROPERTY_NAME: z.string().nullable(),
  CREATED_AT: z.string().nullable(),
});

const TestimonialOutputSchema = z.object({
  name: z.string(),
  propertyName: z.string(),
  quote: z.string(),
  score: z.number(),
  createdAt: z.string().nullable(),
});

export default api({
  name: "GetPMCTestimonials",
  description: "Pulls Zendesk satisfaction ratings for a PMC with sentiment scoring.",

  integrations: {
    snowflake_sso: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    pmc_name: z.string().min(1),
    top_n: z.coerce.number().optional(),
  }),

  output: z.object({
    testimonials: z.array(TestimonialOutputSchema),
  }),

  async run(ctx, { pmc_name, top_n }) {
    const rows = await ctx.integrations.snowflake_sso.query(
      `WITH latest_prop AS (
          SELECT CUSTOMER_PUBLIC_ID, PROPERTY_NAME
          FROM FLEX.REPORT.RPT_RENT_CUSTOMER_STATS_MONTHLY
          WHERE UPPER(PMC_NAME) = UPPER(?)
          QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_PUBLIC_ID ORDER BY BP_MONTH DESC) = 1
      )
      SELECT
          sr.COMMENT,
          u.NAME AS RESIDENT_NAME,
          o.PROPERTY_NAME,
          TO_VARCHAR(sr.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
      FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.SATISFACTION_RATINGS sr
      JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.USERS u
          ON u.ID = sr.REQUESTER_ID
      JOIN latest_prop o
          ON o.CUSTOMER_PUBLIC_ID = u.USER_FIELDS:customer_id::VARCHAR
      WHERE sr.SCORE = 'good'
        AND sr.COMMENT IS NOT NULL
        AND LENGTH(TRIM(sr.COMMENT)) > 50
      ORDER BY sr.CREATED_AT DESC
      LIMIT 30`,
      TestimonialRowSchema,
      [pmc_name],
      { label: "Fetch Zendesk testimonials for PMC" }
    );

    // Deduplicate by comment text, score, sort by sentiment
    const seenComments = new Set<string>();
    const scored: z.infer<typeof TestimonialOutputSchema>[] = [];

    for (const row of rows) {
      const comment = row.COMMENT.trim();
      if (seenComments.has(comment.toLowerCase())) continue;
      seenComments.add(comment.toLowerCase());
      scored.push({
        name: anonymizeName(row.RESIDENT_NAME ?? ""),
        propertyName: row.PROPERTY_NAME ?? "",
        quote: comment,
        score: sentimentScore(comment),
        createdAt: row.CREATED_AT,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, top_n ?? 4);

    return { testimonials: results };
  },
});
