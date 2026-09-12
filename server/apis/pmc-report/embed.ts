/**
 * Embed → DI deck data layer — Clark mirror of Flask's `generator/embed.py`
 * (spec: flex-pmc-reports `docs/superpowers/specs/2026-09-10-embed-deck-design.md`; Flask commits
 * 130b269…2684dc8, e6381a0, 2f100ab, 077cff8).
 *
 * Every embed-only PMC lives under the internal placeholder PMC_ID 2476 in DIM_PROPERTIES_PMCS /
 * EMBED_PROPERTY_MONTHLY_STATS; the real company name is only recoverable per MSP (Yardi / MRI /
 * Zego property lists in INTERNAL_DATA.EMBED_PROPERTY_LISTS, AppFolio toggle_events, or - for the
 * older rows - the dim PMC_NAME itself). This module resolves a picked name to its property rows,
 * pulls that PMC's monthly embed activity, and holds the two network-wide pulls (graduation cohort,
 * channel repeat rates) behind a 6h per-reporting-month cache, plus the pure math the slides need.
 *
 * Flask is the reference: every SQL predicate, threshold and string below is copied from it. The
 * only mechanical difference is bind style - the Snowflake integration takes positional `?` binds,
 * so Flask's named `%(x)s` params become `?` in source order (and `DATEADD('month', -%(n)s, x)`
 * becomes `DATEADD('month', ?, x)` with a negative value bound).
 */

import { z } from "@superblocksteam/sdk-api";
import { summarizeStatesFromProperties, type ParsedProperty, type Market, type StateSummary } from "./market-map-data.js";

// ─── Snowflake client type (minimal, same shape market-map-data.ts uses) ────────

interface SnowflakeClient {
  query<T>(sql: string, schema: z.ZodType<T>, params?: unknown[], meta?: { label?: string }): Promise<T[]>;
}

// ─── Constants (Flask generator/embed.py) ───────────────────────────────────────

export const EMBED_PMC_ID = "2476";
/** Flex's own test property under 2476. */
export const EMBED_TEST_EXCLUDE = "bv2ae21adeef07c4e6fb5d7a301938cj48f";
export const EMBED_GENERIC_NAMES = ["Flex Embed", "Flex Generic Properties OON"] as const;
export const MSP_LABELS: Record<string, string> = { yardi: "Yardi", appfolio: "AppFolio", mri: "MRI", zego: "Zego" };
export const MSP_ORDER = ["yardi", "appfolio", "mri", "zego", "legacy"] as const;
/** Gate: fewer BP months of activity -> "too early for a trend". */
export const EMBED_MIN_MONTHS = 3;
/** Same-MSP cohort needs this many properties, else all MSPs. */
export const GRADUATION_MIN_SAME_MSP = 300;
/** Cohort eligibility: DI at least this many months before the reporting month. */
export const GRADUATION_HEADLINE_MONTHS = 6;
/** Slide 74: a DMA needs this many of THEIR properties. */
export const MARKET_MIN_PROPERTIES = 2;

const EMBED_CACHE_TTL_MS = 6 * 3600 * 1000;

/** The Embed deck's gate messages, verbatim from the Flask spec (§Gates). Flask returns them as
 * 400 / 404 bodies; Clark's API has no status code to set, so they ride back as `error` (the shape
 * the Platinum / Check-in decks already use). Constants so the orchestration and the tests read
 * the same strings. */
export const EMBED_GATES = {
  noName: "The Embed deck needs a PMC name.",
  onePmc: "The Embed deck is one PMC per deck - remove the additional PMCs / property IDs and try again.",
  unknownPmc: (name: string) => `No embed activity found for: ${name}`,
  tooEarly: (name: string) => `${name} has under 3 months of embed activity — too early for a trend; try again next month.`,
  noTotalUnits: (name: string, mspLabel: string) => `Enter ${name}'s total units — ${mspLabel} embed doesn't report unit counts.`,
} as const;

const DIM = "PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS";
const STATS = "PRODUCTION.ANALYTICS.EMBED_PROPERTY_MONTHLY_STATS";
const OUTCOMES = "PRODUCTION.ANALYTICS.CUSTOMER_BP_MONTH_OUTCOMES";
const BP = "PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS";
const BILLERS = "PRODUCTION.ANALYTICS.AE_EMBED_BILLERS";
const YARDI_CFG = "PRODUCTION.BASE_FLEX2.PRODUCT_BASE_YARDI_PMC_CONFIGS";
const LIST_YARDI = "INTERNAL_DATA.EMBED_PROPERTY_LISTS.EMBED_PROPERTY_LIST_YARDI";
const LIST_MRI = "INTERNAL_DATA.EMBED_PROPERTY_LISTS.EMBED_PROPERTY_LIST_MRI";
const LIST_ZEGO = "INTERNAL_DATA.EMBED_PROPERTY_LISTS.EMBED_PROPERTY_LIST_ZEGO";
const TOGGLE = "flex2_backend_shared.appfolio_integration.toggle_events";

// ─── Month helpers ──────────────────────────────────────────────────────────────

/** Flask `generator/data._bp_safe_cutoff` (the same helper every Clark API re-declares). */
export function bpSafeCutoff(today: Date = new Date()): string {
  const day = today.getDate();
  const cutoff = day <= 5
    ? new Date(today.getFullYear(), today.getMonth(), 1)
    : new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-01`;
}

/** The reporting month: the latest completed BP month = bpSafeCutoff() minus one month (Flask
 * `latest_embed_bp_month`, same arithmetic as prospect.pull_embed_usage). */
export function latestEmbedBpMonth(today: Date = new Date()): string {
  const [y, m] = bpSafeCutoff(today).split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Shift a "YYYY-MM-01" month string by n months. */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// ─── Cache (Flask `_cached`; same shape as geo-regions.ts cachedNetworkZipGeo) ──
// A null result (empty / failed pull) is returned but NOT stored, so the next call retries.

const embedCache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T | null>, now: () => number = Date.now): Promise<T | null> {
  const hit = embedCache.get(key);
  if (hit && now() - hit.at < EMBED_CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  if (value !== null && value !== undefined) embedCache.set(key, { at: now(), value });
  return value ?? null;
}

/** Test hook — clears the per-reporting-month cache. */
export function _resetEmbedCache(): void {
  embedCache.clear();
}

// ─── Resolver ───────────────────────────────────────────────────────────────────

// Every branch selects the SAME property columns from the dim (aliases are the row fields below)
// plus PMC_DISPLAY_NAME / LIST_UNIT_TOTAL / INTEGRATION_NAME, deduped to one row per property (the
// dim carries one row per re-sync). ZIP is trimmed to 5 for the DMA seed join.
const DIM_COLS = `
            DIM.PROPERTY_PUBLIC_ID          AS PROPERTY_PUBLIC_ID,
            DIM.PROPERTY_NAME               AS PROPERTY_NAME,
            DIM.PROPERTY_ADDRESS_LINE1      AS ADDRESS,
            DIM.PROPERTY_CITY               AS CITY,
            DIM.PROPERTY_STATE              AS STATE,
            LEFT(DIM.PROPERTY_ZIP, 5)       AS ZIP,
            DIM.BILLER_ID                   AS BILLER_ID,
            DIM.INTEGRATION_NAME            AS INTEGRATION_NAME`;

// Yardi: list client_name -> database_name; dim rows carry the database via the PMC config (or the
// embed biller metadata), and the per-property voyager code the same way - exactly the join the
// analytics oon-embed-lookup skill and prospect.pull_embed_usage use.
const YARDI_EMB_CTE = `
        emb AS (
            SELECT ${DIM_COLS},
                   DIM.PROPERTY_UNIT_COUNT AS DIM_UNIT_COUNT,
                   COALESCE(FIG.YARDI_DATABASE_NAME, EMB.PROPERTY_METADATA:yardi_database_name::STRING) AS DB_NAME,
                   COALESCE(DIM.EXTERNAL_PROPERTY_ID, EMB.PROPERTY_METADATA:voyager_code::STRING)      AS VOYAGER_CODE
            FROM ${DIM} DIM
            LEFT JOIN ${YARDI_CFG} FIG
                ON DIM.PMC_ID = FIG.INTERNAL_PMC_ID AND DIM.EXTERNAL_PMC_ID = FIG.YARDI_SITE_ID
            LEFT JOIN ${BILLERS} EMB
                ON DIM.PROPERTY_PUBLIC_ID = EMB.PROPERTY_PUBLIC_ID AND DIM.BILLER_ID = EMB.BILLER_ID
            WHERE DIM.INTEGRATION_NAME = 'yardi'
              AND DIM.PMC_ID = ${EMBED_PMC_ID}
              AND DIM.IS_ACTIVE = TRUE
              AND DIM.PROPERTY_PUBLIC_ID != ?
            QUALIFY ROW_NUMBER() OVER (PARTITION BY DIM.PROPERTY_PUBLIC_ID ORDER BY DIM.CREATED_AT_UTC DESC) = 1
        )`;

// The MSP embed lists are monthly snapshots that LAG the stats table (live 2026-09-10: Yardi's
// latest `month` was 2026-07-01, MRI / Zego 2026-05-01 vs stats 2026-09-01), so every list read
// takes the list's own latest snapshot - `month = (SELECT MAX(month) FROM <list>)` - not the
// reporting month (which returned zero Yardi / MRI / Zego rows live).
// Bind order per branch is always [name, excl].
const RESOLVE_SQL: Record<string, string> = {
  yardi: `
        WITH yl AS (
            SELECT client_name, database_name, voyager_property_code, TO_DECIMAL(unit_count) AS unit_count
            FROM ${LIST_YARDI}
            WHERE UPPER(client_name) = UPPER(?) AND month = (SELECT MAX(month) FROM ${LIST_YARDI})
        ),
        ${YARDI_EMB_CTE}
        SELECT MAX(yn.client_name)                                   AS PMC_DISPLAY_NAME,
               e.PROPERTY_PUBLIC_ID, e.PROPERTY_NAME, e.ADDRESS, e.CITY, e.STATE, e.ZIP, e.BILLER_ID, e.INTEGRATION_NAME,
               COALESCE(MAX(yl.unit_count), MAX(e.DIM_UNIT_COUNT))   AS UNIT_COUNT,
               (SELECT SUM(unit_count) FROM yl)                      AS LIST_UNIT_TOTAL
        FROM emb e
        JOIN (SELECT DISTINCT client_name, database_name FROM yl) yn ON yn.database_name = e.DB_NAME
        LEFT JOIN yl ON yl.database_name = e.DB_NAME AND yl.voyager_property_code = e.VOYAGER_CODE
        GROUP BY e.PROPERTY_PUBLIC_ID, e.PROPERTY_NAME, e.ADDRESS, e.CITY, e.STATE, e.ZIP, e.BILLER_ID, e.INTEGRATION_NAME
        ORDER BY e.PROPERTY_NAME
    `,
  appfolio: `
        WITH latest AS (
            SELECT company_name, vhost_guid
            FROM ${TOGGLE}
            WHERE UPPER(company_name) = UPPER(?)
              AND NOT (company_name ILIKE 'PRACTICE SITE%' OR vhost ILIKE 'PRACTICE SITE%')
            QUALIFY ROW_NUMBER() OVER (PARTITION BY company_name, vhost ORDER BY update_at DESC) = 1
        )
        SELECT l.company_name AS PMC_DISPLAY_NAME, ${DIM_COLS},
               DIM.PROPERTY_UNIT_COUNT AS UNIT_COUNT,
               NULL                    AS LIST_UNIT_TOTAL
        FROM latest l
        JOIN ${DIM} DIM
          ON DIM.EXTERNAL_PMC_ID = l.vhost_guid
         AND DIM.INTEGRATION_NAME = 'appfolio'
         AND DIM.PMC_ID = ${EMBED_PMC_ID}
         AND DIM.IS_ACTIVE = TRUE
         AND DIM.PROPERTY_PUBLIC_ID != ?
        QUALIFY ROW_NUMBER() OVER (PARTITION BY DIM.PROPERTY_PUBLIC_ID ORDER BY DIM.CREATED_AT_UTC DESC) = 1
        ORDER BY DIM.PROPERTY_NAME
    `,
  mri: `
        WITH mp AS (
            SELECT TRIM(pmc_name) AS pmc_name, flex_property_id, unit_count
            FROM ${LIST_MRI}
            WHERE UPPER(TRIM(pmc_name)) = UPPER(?) AND month = (SELECT MAX(month) FROM ${LIST_MRI})
        ),
        sm AS (
            -- MRI list ids are the stats table's EMBED_PROPERTY_ID (a UUID), never a dim
            -- PROPERTY_PUBLIC_ID (live 2026-09-10: 0 of 4,521 list ids matched the dim directly,
            -- 587 of 611 billed ones land via the stats row's PROPERTY_PUBLIC_ID).
            SELECT s.EMBED_PROPERTY_ID, s.PROPERTY_PUBLIC_ID
            FROM ${STATS} s
            WHERE s.PMC_ID = '${EMBED_PMC_ID}' AND s.PROPERTY_PUBLIC_ID IS NOT NULL
            QUALIFY ROW_NUMBER() OVER (PARTITION BY s.EMBED_PROPERTY_ID ORDER BY s.BP_MONTH DESC) = 1
        )
        SELECT mp.pmc_name AS PMC_DISPLAY_NAME, ${DIM_COLS},
               COALESCE(mp.unit_count, DIM.PROPERTY_UNIT_COUNT) AS UNIT_COUNT,
               (SELECT SUM(unit_count) FROM mp)                 AS LIST_UNIT_TOTAL
        FROM mp
        JOIN sm ON sm.EMBED_PROPERTY_ID = mp.flex_property_id
        JOIN ${DIM} DIM
          ON DIM.PROPERTY_PUBLIC_ID = sm.PROPERTY_PUBLIC_ID
         AND DIM.PMC_ID = ${EMBED_PMC_ID}
         AND DIM.IS_ACTIVE = TRUE
         AND DIM.PROPERTY_PUBLIC_ID != ?
        QUALIFY ROW_NUMBER() OVER (PARTITION BY DIM.PROPERTY_PUBLIC_ID ORDER BY DIM.CREATED_AT_UTC DESC) = 1
        ORDER BY DIM.PROPERTY_NAME
    `,
  zego: `
        WITH zg AS (
            SELECT pmc_company, property_id::STRING AS zego_uuid, unit_count
            FROM ${LIST_ZEGO}
            WHERE UPPER(pmc_company) = UPPER(?) AND month = (SELECT MAX(month) FROM ${LIST_ZEGO})
        )
        SELECT zg.pmc_company AS PMC_DISPLAY_NAME, ${DIM_COLS},
               COALESCE(zg.unit_count, DIM.PROPERTY_UNIT_COUNT) AS UNIT_COUNT,
               (SELECT SUM(unit_count) FROM zg)                 AS LIST_UNIT_TOTAL
        FROM zg
        JOIN ${BILLERS} b ON zg.zego_uuid = b.PROPERTY_METADATA:external_property_id::STRING
        JOIN ${DIM} DIM
          ON DIM.PROPERTY_PUBLIC_ID = b.PROPERTY_PUBLIC_ID
         AND DIM.PMC_ID = ${EMBED_PMC_ID}
         AND DIM.IS_ACTIVE = TRUE
         AND DIM.PROPERTY_PUBLIC_ID != ?
        QUALIFY ROW_NUMBER() OVER (PARTITION BY DIM.PROPERTY_PUBLIC_ID ORDER BY DIM.CREATED_AT_UTC DESC) = 1
        ORDER BY DIM.PROPERTY_NAME
    `,
  // Legacy: the dim carries a real PMC_NAME under 2476 (what list_oon_pmcs used to return).
  legacy: `
        SELECT DIM.PMC_NAME AS PMC_DISPLAY_NAME, ${DIM_COLS},
               DIM.PROPERTY_UNIT_COUNT AS UNIT_COUNT,
               NULL                    AS LIST_UNIT_TOTAL
        FROM ${DIM} DIM
        WHERE DIM.PMC_ID = ${EMBED_PMC_ID}
          AND DIM.IS_ACTIVE = TRUE
          AND UPPER(DIM.PMC_NAME) = UPPER(?)
          AND DIM.PMC_NAME NOT IN ('Flex Embed', 'Flex Generic Properties OON')
          AND DIM.PROPERTY_PUBLIC_ID != ?
        QUALIFY ROW_NUMBER() OVER (PARTITION BY DIM.PROPERTY_PUBLIC_ID ORDER BY DIM.CREATED_AT_UTC DESC) = 1
        ORDER BY DIM.PROPERTY_NAME
    `,
};

const ResolveRowSchema = z.object({
  PMC_DISPLAY_NAME: z.string().nullable(),
  PROPERTY_PUBLIC_ID: z.string(),
  PROPERTY_NAME: z.string().nullable(),
  ADDRESS: z.string().nullable(),
  CITY: z.string().nullable(),
  STATE: z.string().nullable(),
  ZIP: z.string().nullable(),
  BILLER_ID: z.coerce.number().nullable(),
  INTEGRATION_NAME: z.string().nullable(),
  UNIT_COUNT: z.coerce.number().nullable(),
  LIST_UNIT_TOTAL: z.coerce.number().nullable(),
});

export interface EmbedProperty {
  property_public_id: string;
  property_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  /** null whenever the source value is NULL or <= 1, the dim placeholder. */
  unit_count: number | null;
  biller_id: number | null;
}

export interface ResolvedEmbedPmc {
  msp: string;
  msp_label: string;
  pmc_display_name: string;
  /** SUM(unit_count) of the MSP embed list (yardi/mri/zego); null for appfolio/legacy. */
  list_unit_total: number | null;
  properties: EmbedProperty[];
}

/** Real unit count or null. The dim stores 1 as a placeholder for list-less MSPs (AppFolio). */
export function cleanUnits(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n : null;
}

/** Leading decorations the AppFolio toggle source carries. */
const NAME_JUNK_PREFIX = new Set(["*", "-", '"', "'", "`", "“", "”", "‘", "’"]);
const PRACTICE_SITE_RE = /^PRACTICE SITE/i;

function stripJunkPrefix(s: string): string {
  let i = 0;
  while (i < s.length && NAME_JUNK_PREFIX.has(s[i])) i++;
  return s.slice(i);
}

/**
 * Picker junk filter (Flask `_is_real_pmc_name`, 2f100ab). The AppFolio toggle_events source
 * carries company_name values like '"', '-', '*Coldwell...', blanks and 2-letter stubs. Real =
 * after stripping whitespace and leading * / - / quotes, at least 3 characters and at least 3
 * letters; never a PRACTICE SITE vhost and never one of the generic dim names
 * (EMBED_GENERIC_NAMES). The check is on the cleaned form only - callers keep the original string,
 * because the resolver matches the source column on it verbatim.
 */
export function isRealPmcName(name: unknown): boolean {
  if (name === null || name === undefined) return false;
  const s = stripJunkPrefix(String(name).trim()).trim();
  const letters = [...s].filter((ch) => /\p{L}/u.test(ch)).length;
  if (s.length < 3 || letters < 3) return false;
  if (PRACTICE_SITE_RE.test(s)) return false;
  if ((EMBED_GENERIC_NAMES as readonly string[]).includes(s)) return false;
  return true;
}

/**
 * Picked name -> {msp, msp_label, pmc_display_name, list_unit_total, properties}. Tries the sources
 * in MSP_ORDER (yardi, appfolio, mri, zego, legacy) and takes the first that returns property rows;
 * null when none do (the 404 gate).
 */
export async function resolveEmbedPmc(sf: SnowflakeClient, name: string): Promise<ResolvedEmbedPmc | null> {
  const picked = name.trim();
  for (const msp of MSP_ORDER) {
    const rows = await sf.query(RESOLVE_SQL[msp], ResolveRowSchema, [picked, EMBED_TEST_EXCLUDE], {
      label: `Resolve embed PMC (${msp})`,
    });
    if (rows.length === 0) continue;
    const properties: EmbedProperty[] = rows.map((r) => ({
      property_public_id: r.PROPERTY_PUBLIC_ID,
      property_name: r.PROPERTY_NAME || r.PROPERTY_PUBLIC_ID,
      address: r.ADDRESS || "",
      city: r.CITY || "",
      state: (r.STATE || "").trim().toUpperCase(),
      zip: (r.ZIP || "").trim().slice(0, 5),
      unit_count: cleanUnits(r.UNIT_COUNT),
      biller_id: r.BILLER_ID ?? null,
    }));
    // Legacy path: the MSP is the modal dim INTEGRATION_NAME, lower-cased.
    let mspKey: string = msp;
    if (msp === "legacy") {
      const names = rows.map((r) => String(r.INTEGRATION_NAME || "").toLowerCase()).filter(Boolean);
      if (names.length > 0) {
        const counts = new Map<string, number>();
        for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
        mspKey = [...counts.entries()].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
      }
    }
    const lt = rows[0].LIST_UNIT_TOTAL;
    // Display name from the source (AppFolio: toggle_events.company_name, which can be junk like
    // '"' or '-'); fall back to the picked name when the source value isn't a real name.
    const display = rows[0].PMC_DISPLAY_NAME;
    return {
      msp: mspKey,
      msp_label: MSP_LABELS[mspKey] ?? mspKey.charAt(0).toUpperCase() + mspKey.slice(1),
      pmc_display_name: isRealPmcName(display) ? String(display) : picked,
      list_unit_total: lt !== null && lt !== undefined && lt > 0 ? Math.trunc(lt) : null,
      properties,
    };
  }
  return null;
}

// ─── Picker list ────────────────────────────────────────────────────────────────

const ACTIVE_STATS = `
        act AS (
            SELECT DISTINCT COALESCE(s.PROPERTY_PUBLIC_ID, s.EMBED_PROPERTY_ID) AS property_public_id,
                            s.EMBED_PROPERTY_ID                                  AS embed_property_id
            FROM ${STATS} s
            WHERE s.PMC_ID = '${EMBED_PMC_ID}'
              AND s.BILLS_PAID > 0
              AND s.BP_MONTH >= DATEADD('month', -12, CURRENT_DATE())
              AND s.BP_MONTH < ?
              AND s.EMBED_PROPERTY_ID != ?
        )`;

/** Bind order: [cutoff, excl] everywhere, plus a second `excl` for Yardi's emb CTE. */
const LIST_SQL: Record<string, string> = {
  yardi: `
        WITH ${ACTIVE_STATS},
        ${YARDI_EMB_CTE}
        SELECT yl.client_name AS NAME, COUNT(DISTINCT e.PROPERTY_PUBLIC_ID) AS PROPERTY_COUNT
        FROM (SELECT DISTINCT client_name, database_name FROM ${LIST_YARDI} WHERE month = (SELECT MAX(month) FROM ${LIST_YARDI})) yl
        JOIN emb e ON e.DB_NAME = yl.database_name
        JOIN act   ON act.property_public_id = e.PROPERTY_PUBLIC_ID
        GROUP BY yl.client_name
        ORDER BY yl.client_name
    `,
  appfolio: `
        WITH ${ACTIVE_STATS},
        latest AS (
            SELECT company_name, vhost_guid
            FROM ${TOGGLE}
            WHERE company_name IS NOT NULL
              AND NOT (company_name ILIKE 'PRACTICE SITE%' OR vhost ILIKE 'PRACTICE SITE%')
            QUALIFY ROW_NUMBER() OVER (PARTITION BY company_name, vhost ORDER BY update_at DESC) = 1
        )
        SELECT l.company_name AS NAME, COUNT(DISTINCT DIM.PROPERTY_PUBLIC_ID) AS PROPERTY_COUNT
        FROM latest l
        JOIN ${DIM} DIM
          ON DIM.EXTERNAL_PMC_ID = l.vhost_guid AND DIM.INTEGRATION_NAME = 'appfolio'
         AND DIM.PMC_ID = ${EMBED_PMC_ID} AND DIM.IS_ACTIVE = TRUE
        JOIN act ON act.property_public_id = DIM.PROPERTY_PUBLIC_ID
        GROUP BY l.company_name
        ORDER BY l.company_name
    `,
  mri: `
        WITH ${ACTIVE_STATS}
        SELECT TRIM(mp.pmc_name) AS NAME, COUNT(DISTINCT mp.flex_property_id) AS PROPERTY_COUNT
        FROM ${LIST_MRI} mp
        JOIN act ON act.embed_property_id = mp.flex_property_id
        WHERE mp.month = (SELECT MAX(month) FROM ${LIST_MRI})
        GROUP BY TRIM(mp.pmc_name)
        ORDER BY 1
    `,
  zego: `
        WITH ${ACTIVE_STATS}
        SELECT zg.pmc_company AS NAME, COUNT(DISTINCT b.PROPERTY_PUBLIC_ID) AS PROPERTY_COUNT
        FROM ${LIST_ZEGO} zg
        JOIN ${BILLERS} b ON zg.property_id::STRING = b.PROPERTY_METADATA:external_property_id::STRING
        JOIN act ON act.property_public_id = b.PROPERTY_PUBLIC_ID
        WHERE zg.month = (SELECT MAX(month) FROM ${LIST_ZEGO})
        GROUP BY zg.pmc_company
        ORDER BY zg.pmc_company
    `,
  legacy: `
        WITH ${ACTIVE_STATS}
        SELECT DIM.PMC_NAME AS NAME, COUNT(DISTINCT DIM.PROPERTY_PUBLIC_ID) AS PROPERTY_COUNT
        FROM ${DIM} DIM
        JOIN act ON act.property_public_id = DIM.PROPERTY_PUBLIC_ID
        WHERE DIM.PMC_ID = ${EMBED_PMC_ID}
          AND DIM.PMC_NAME IS NOT NULL
          AND DIM.PMC_NAME NOT IN ('Flex Embed', 'Flex Generic Properties OON')
        GROUP BY DIM.PMC_NAME
        ORDER BY DIM.PMC_NAME
    `,
};

const ListRowSchema = z.object({
  NAME: z.string().nullable(),
  PROPERTY_COUNT: z.coerce.number().nullable(),
});

export interface EmbedPmcRow {
  name: string;
  msp: string;
  property_count: number;
}

/**
 * Picker feed for `/pmcs?mode=embed`: [{name, msp, property_count}] - one row per embed PMC with
 * BILLS_PAID > 0 in the last 12 BP months, across all four MSPs plus the legacy dim-name path.
 * Deduped case-insensitively in MSP_ORDER (first source wins), sorted by name. Junk names (see
 * isRealPmcName) are dropped.
 */
export async function listEmbedPmcs(sf: SnowflakeClient, today: Date = new Date()): Promise<EmbedPmcRow[]> {
  const cutoff = bpSafeCutoff(today);
  const seen = new Map<string, EmbedPmcRow>();
  for (const msp of MSP_ORDER) {
    const binds = msp === "yardi"
      ? [cutoff, EMBED_TEST_EXCLUDE, EMBED_TEST_EXCLUDE]
      : [cutoff, EMBED_TEST_EXCLUDE];
    const rows = await sf.query(LIST_SQL[msp], ListRowSchema, binds, { label: `List embed PMCs (${msp})` });
    for (const r of rows) {
      const nm = String(r.NAME ?? "").trim();
      if (!isRealPmcName(nm) || seen.has(nm.toUpperCase())) continue;
      seen.set(nm.toUpperCase(), { name: nm, msp, property_count: Math.trunc(r.PROPERTY_COUNT ?? 0) });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// ─── Monthly activity ──────────────────────────────────────────────────────────

export interface EmbedMonthlyRow {
  bp_month: string;
  property_public_id: string;
  charged_users: number;
  bills_paid: number;
  rent_paid: number;
}

const MonthlyRowSchema = z.object({
  BP_MONTH: z.string(),
  PROPERTY_PUBLIC_ID: z.string(),
  CHARGED_USERS: z.coerce.number().nullable(),
  BILLS_PAID: z.coerce.number().nullable(),
  RENT_PAID: z.coerce.number().nullable(),
});

/**
 * One row per (bp_month, property) for the resolved properties: users / bills from
 * EMBED_PROPERTY_MONTHLY_STATS (PMC 2476), rent from CUSTOMER_BP_MONTH_OUTCOMES.BILL_PAYMENT_AMOUNT
 * where IS_EMBED_ATTRIBUTED_CUSTOMER AND PMC_ID = '2476' (PMC_ID is a STRING there), joined on
 * PROPERTY_PUBLIC_ID. The stats table keys yardi/appfolio/zego rows by PROPERTY_PUBLIC_ID and
 * mri/legacy rows by EMBED_PROPERTY_ID, so both are matched (COALESCE).
 */
export async function pullEmbedMonthly(
  sf: SnowflakeClient,
  propertyIds: string[],
  lookbackMonths = 12,
  today: Date = new Date(),
): Promise<EmbedMonthlyRow[]> {
  const ids = propertyIds.filter(Boolean).map(String);
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(",");
  const sql = `
        WITH stats AS (
            SELECT s.BP_MONTH                                             AS BP_MONTH,
                   COALESCE(s.PROPERTY_PUBLIC_ID, s.EMBED_PROPERTY_ID)    AS PROPERTY_PUBLIC_ID,
                   SUM(COALESCE(s.CHARGED_USERS, 0))                      AS CHARGED_USERS,
                   SUM(COALESCE(s.BILLS_PAID, 0))                         AS BILLS_PAID
            FROM ${STATS} s
            WHERE s.PMC_ID = '${EMBED_PMC_ID}'
              AND (s.PROPERTY_PUBLIC_ID IN (${ph}) OR s.EMBED_PROPERTY_ID IN (${ph}))
              AND s.BP_MONTH >= DATEADD('month', ?, CURRENT_DATE())
              AND s.BP_MONTH < ?
            GROUP BY 1, 2
        ),
        rent AS (
            SELECT c.BP_MONTH AS BP_MONTH, c.PROPERTY_PUBLIC_ID AS PROPERTY_PUBLIC_ID,
                   SUM(c.BILL_PAYMENT_AMOUNT) AS RENT_PAID
            FROM ${OUTCOMES} c
            WHERE c.PMC_ID = '${EMBED_PMC_ID}'
              AND c.IS_EMBED_ATTRIBUTED_CUSTOMER = TRUE
              AND c.PROPERTY_PUBLIC_ID IN (${ph})
              AND c.BILL_PAYMENT_AMOUNT > 0
              AND c.BP_MONTH >= DATEADD('month', ?, CURRENT_DATE())
              AND c.BP_MONTH < ?
            GROUP BY 1, 2
        )
        SELECT TO_VARCHAR(st.BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH, st.PROPERTY_PUBLIC_ID,
               st.CHARGED_USERS, st.BILLS_PAID,
               COALESCE(r.RENT_PAID, 0) AS RENT_PAID
        FROM stats st
        LEFT JOIN rent r ON r.BP_MONTH = st.BP_MONTH AND r.PROPERTY_PUBLIC_ID = st.PROPERTY_PUBLIC_ID
        ORDER BY st.BP_MONTH, st.PROPERTY_PUBLIC_ID
    `;
  const lookback = -Math.trunc(lookbackMonths);
  const cutoff = bpSafeCutoff(today);
  const rows = await sf.query(
    sql,
    MonthlyRowSchema,
    [...ids, ...ids, lookback, cutoff, ...ids, lookback, cutoff],
    { label: "Pull embed monthly activity (users/bills + embed-attributed rent)" },
  );
  return rows.map((r) => ({
    bp_month: r.BP_MONTH.slice(0, 10),
    property_public_id: r.PROPERTY_PUBLIC_ID,
    charged_users: Math.trunc(r.CHARGED_USERS ?? 0),
    bills_paid: Math.trunc(r.BILLS_PAID ?? 0),
    rent_paid: Number(r.RENT_PAID ?? 0),
  }));
}

export interface EmbedMonthSummary {
  bp_month: string;
  charged_users: number;
  bills_paid: number;
  rent_paid: number;
  /** Distinct properties with bills_paid > 0 that month. */
  properties: number;
}

/** Portfolio totals per BP month for slide 71 and the ctx tiles (Flask `summarize_embed_monthly`). */
export function summarizeEmbedMonthly(monthly: EmbedMonthlyRow[] | null | undefined): EmbedMonthSummary[] {
  if (!monthly || monthly.length === 0) return [];
  const byMonth = new Map<string, EmbedMonthSummary>();
  const payingProps = new Map<string, Set<string>>();
  for (const r of monthly) {
    const cur = byMonth.get(r.bp_month) ?? { bp_month: r.bp_month, charged_users: 0, bills_paid: 0, rent_paid: 0, properties: 0 };
    cur.charged_users += r.charged_users;
    cur.bills_paid += r.bills_paid;
    cur.rent_paid += r.rent_paid;
    byMonth.set(r.bp_month, cur);
    if (r.bills_paid > 0) {
      const set = payingProps.get(r.bp_month) ?? new Set<string>();
      set.add(r.property_public_id);
      payingProps.set(r.bp_month, set);
    }
  }
  const out = [...byMonth.values()];
  for (const row of out) row.properties = payingProps.get(row.bp_month)?.size ?? 0;
  return out.sort((a, b) => a.bp_month.localeCompare(b.bp_month));
}

// ─── Graduation cohort (network-wide, cached) ──────────────────────────────────

/** Bind order: [excl, (msp), -elig, rpt, -before, after, rpt]. */
function graduationSql(withMsp: boolean): string {
  return `
        WITH embed_first AS (
            SELECT COALESCE(s.PROPERTY_PUBLIC_ID, s.EMBED_PROPERTY_ID) AS pid, MIN(s.BP_MONTH) AS first_embed
            FROM ${STATS} s
            WHERE s.PMC_ID = '${EMBED_PMC_ID}'
              AND s.BILLS_PAID > 0
              AND s.EMBED_PROPERTY_ID != ?
              ${withMsp ? "AND s.EMBED_SOURCE = ?" : ""}
            GROUP BY 1
        ),
        di_first AS (
            SELECT t.PROPERTY_PUBLIC_ID AS pid,
                   MIN(t.BP_MONTH)            AS di_month,
                   MAX(t.PROPERTY_UNIT_COUNT) AS units,
                   MAX(t.PMC_NAME)            AS pmc_name
            FROM ${BP} t
            WHERE t.IS_IN_NETWORK = TRUE AND t.IS_INTEGRATED_TOTAL = TRUE
            GROUP BY 1
        ),
        cohort AS (
            SELECT e.pid, d.di_month, d.units, d.pmc_name
            FROM embed_first e
            JOIN di_first d ON d.pid = e.pid
            WHERE d.di_month > e.first_embed
              AND d.di_month <= DATEADD('month', ?, ?)
        ),
        before_side AS (
            SELECT c.pid, DATEDIFF('month', c.di_month, s.BP_MONTH) AS rel_month,
                   COALESCE(s.BILLS_PAID, 0) AS bills_paid, c.units
            FROM cohort c
            JOIN ${STATS} s
              ON COALESCE(s.PROPERTY_PUBLIC_ID, s.EMBED_PROPERTY_ID) = c.pid AND s.PMC_ID = '${EMBED_PMC_ID}'
            WHERE s.BP_MONTH < c.di_month
              AND s.BP_MONTH >= DATEADD('month', ?, c.di_month)
        ),
        after_side AS (
            SELECT c.pid, DATEDIFF('month', c.di_month, t.BP_MONTH) AS rel_month,
                   COALESCE(t.BILLS_PAID_COUNT, 0) AS bills_paid, c.units
            FROM cohort c
            JOIN ${BP} t
              ON t.PROPERTY_PUBLIC_ID = c.pid AND t.IS_IN_NETWORK = TRUE AND t.IS_INTEGRATED_TOTAL = TRUE
            WHERE t.BP_MONTH >= c.di_month
              AND t.BP_MONTH <= DATEADD('month', ?, c.di_month)
              AND t.BP_MONTH <= ?
        ),
        both AS (SELECT * FROM before_side UNION ALL SELECT * FROM after_side)
        SELECT b.rel_month                AS REL_MONTH,
               COUNT(DISTINCT b.pid)      AS PROPERTIES,
               SUM(b.units)               AS UNITS,
               SUM(b.bills_paid)          AS BILLS_PAID,
               (SELECT COUNT(*) FROM cohort)                 AS COHORT_PROPERTIES,
               (SELECT SUM(units) FROM cohort)               AS COHORT_UNITS,
               (SELECT COUNT(DISTINCT pmc_name) FROM cohort) AS COHORT_PMCS
        FROM both b
        GROUP BY b.rel_month
        ORDER BY b.rel_month
    `;
}

const GraduationRowSchema = z.object({
  REL_MONTH: z.coerce.number(),
  PROPERTIES: z.coerce.number().nullable(),
  UNITS: z.coerce.number().nullable(),
  BILLS_PAID: z.coerce.number().nullable(),
  COHORT_PROPERTIES: z.coerce.number().nullable(),
  COHORT_UNITS: z.coerce.number().nullable(),
  COHORT_PMCS: z.coerce.number().nullable(),
});

export interface GraduationCurvePoint {
  rel_month: number;
  properties: number;
  units: number;
  bills_paid: number;
  adoption: number;
}

export interface GraduationCurve {
  curve: GraduationCurvePoint[];
  /** Pooled bills/units over rel_month in {-3,-2,-1}, full eligible cohort. */
  before_rate: number;
  /** Pooled bills/units over rel_month in {4,5,6}, full eligible cohort. */
  after_rate: number;
  properties: number;
  units: number;
  pmcs: number;
  /** Largest rel_month whose properties >= 0.5 * cohort properties (solid to here, faded beyond). */
  curve_full_through: number;
  scope: "same_msp" | "all";
  msp: string | null;
}

function pooledRate(curve: GraduationCurvePoint[], relMonths: number[]): number {
  const sub = curve.filter((p) => relMonths.includes(p.rel_month));
  const units = sub.reduce((a, p) => a + p.units, 0);
  return units > 0 ? sub.reduce((a, p) => a + p.bills_paid, 0) / units : 0;
}

/**
 * Largest rel_month still backed by >= half the cohort (the renderer draws solid to here, faded
 * beyond - "fewer switchers have been on DI this long"). Falls back to the smallest rel_month when
 * no point clears half (cohort_props 0 => everything clears).
 */
export function curveFullThrough(curve: GraduationCurvePoint[], cohortProps: number): number {
  const ok = curve.filter((p) => p.properties >= 0.5 * (cohortProps || 0));
  if (ok.length > 0) return Math.max(...ok.map((p) => p.rel_month));
  return Math.min(...curve.map((p) => p.rel_month));
}

async function runGraduation(
  sf: SnowflakeClient,
  msp: string | null,
  monthsBefore: number,
  monthsAfter: number,
  rpt: string,
): Promise<GraduationCurve | null> {
  const binds: unknown[] = [EMBED_TEST_EXCLUDE];
  if (msp) binds.push(msp);
  binds.push(-GRADUATION_HEADLINE_MONTHS, rpt, -Math.trunc(monthsBefore), Math.trunc(monthsAfter), rpt);
  const rows = await sf.query(graduationSql(msp !== null), GraduationRowSchema, binds, {
    label: msp ? `Pull graduation curve (${msp})` : "Pull graduation curve (all MSPs)",
  });
  if (rows.length === 0) return null;
  const curve: GraduationCurvePoint[] = rows
    .map((r) => {
      const units = Math.trunc(r.UNITS ?? 0);
      const bills = Math.trunc(r.BILLS_PAID ?? 0);
      return {
        rel_month: Math.trunc(r.REL_MONTH),
        properties: Math.trunc(r.PROPERTIES ?? 0),
        units,
        bills_paid: bills,
        adoption: units > 0 ? bills / units : 0,
      };
    })
    .sort((a, b) => a.rel_month - b.rel_month);
  const cohortProps = Math.trunc(rows[0].COHORT_PROPERTIES ?? 0);
  return {
    curve,
    before_rate: pooledRate(curve, [-3, -2, -1]),
    after_rate: pooledRate(curve, [4, 5, 6]),
    properties: cohortProps,
    units: Math.trunc(rows[0].COHORT_UNITS ?? 0),
    pmcs: Math.trunc(rows[0].COHORT_PMCS ?? 0),
    curve_full_through: curveFullThrough(curve, cohortProps),
    scope: msp ? "same_msp" : "all",
    msp,
  };
}

/**
 * Same-properties before/after DI curve (spec: ~5.4k props / 240k units, 2.6% -> 7.2% at Sep 2026
 * BP, all MSPs).
 *
 * Cohort eligibility is decoupled from curve extent: a property qualifies when its first DI month
 * is at least GRADUATION_HEADLINE_MONTHS (6) before the reporting month - enough to compute the
 * +4..+6 headline - while the curve spans -monthsBefore..+monthsAfter (12). `properties` / `units`
 * / `pmcs` and the pooled before_rate (-3..-1) / after_rate (+4..+6) describe that full eligible
 * cohort; each curve point beyond +6 is computed only over the eligible properties that actually
 * have data at that offset (tail thins, never dropped here), and `curve_full_through` marks the
 * last rel_month still backed by >= half the cohort.
 *
 * `msp` restricts the cohort to that EMBED_SOURCE when it has at least GRADUATION_MIN_SAME_MSP
 * properties; otherwise re-runs for all MSPs (scope "all"). Each (reporting month, msp) result is
 * cached 6h. null when the cohort is empty.
 */
export async function pullGraduationCurve(
  sf: SnowflakeClient,
  msp: string | null = null,
  monthsBefore = 6,
  monthsAfter = 12,
  today: Date = new Date(),
): Promise<GraduationCurve | null> {
  const rpt = latestEmbedBpMonth(today);
  if (msp) {
    const same = await cached<GraduationCurve>(
      `graduation|${rpt}|${monthsBefore}|${monthsAfter}|${msp}`,
      () => runGraduation(sf, msp, monthsBefore, monthsAfter, rpt),
    );
    if (same !== null && same.properties >= GRADUATION_MIN_SAME_MSP) return same;
  }
  return cached<GraduationCurve>(
    `graduation|${rpt}|${monthsBefore}|${monthsAfter}|all`,
    () => runGraduation(sf, null, monthsBefore, monthsAfter, rpt),
  );
}

// ─── Channel repeat rates (network-wide, cached) ───────────────────────────────

export interface ChannelRepeatRates {
  embed: number;
  di: number;
  embed_n: number;
  di_n: number;
}

const RepeatRowSchema = z.object({
  CHANNEL: z.string().nullable(),
  REPEATED: z.coerce.number().nullable(),
  ELIGIBLE: z.coerce.number().nullable(),
});

async function runRepeatRates(sf: SnowflakeClient, windowMonths: number, rpt: string): Promise<ChannelRepeatRates | null> {
  // Backward-looking continuity: of the residents who paid in a BP month, the share who ALSO paid
  // the month before - pooled over distinct (customer, BP month) pairs in the window. Only rows
  // that exist are used. The forward-looking version (paid last month -> paid this month) was wrong
  // for embed: a PMC-2476 resident with no bill this month has NO OUTCOMES row, so its denominator
  // only held residents still present (live: embed 0.935 vs DI 0.875, inverted). Live 2026-09-10,
  // Sep 2026 BP, 6 months: DI 0.853 / embed 0.791.
  const sql = `
        SELECT CASE
                 WHEN c.PMC_ID::STRING = '${EMBED_PMC_ID}' THEN 'embed'
                 WHEN c.PMC_ID::STRING <> '${EMBED_PMC_ID}'
                      AND NOT COALESCE(c.IS_EMBED_ATTRIBUTED_CUSTOMER, FALSE)
                      AND c.NETWORK_TYPE = 'IN' AND c.BILLER_TYPE = 'direct_integration' THEN 'di'
               END                                                                       AS CHANNEL,
               COUNT(DISTINCT CASE WHEN c.HAS_BILL_PAID_PREVIOUS_MONTH = TRUE
                                   THEN c.CUSTOMER_ID_FLEX_2 END, c.BP_MONTH)             AS REPEATED,
               COUNT(DISTINCT c.CUSTOMER_ID_FLEX_2, c.BP_MONTH)                          AS ELIGIBLE
        FROM ${OUTCOMES} c
        WHERE c.HAS_BILL_PAID = TRUE
          AND c.BP_MONTH >  DATEADD('month', ?, ?)
          AND c.BP_MONTH <= ?
        GROUP BY 1
        HAVING CHANNEL IS NOT NULL
    `;
  const rows = await sf.query(sql, RepeatRowSchema, [-Math.trunc(windowMonths), rpt, rpt], {
    label: "Pull channel repeat (resident continuity) rates",
  });
  const by = new Map<string, [number, number]>();
  for (const r of rows) {
    if (!r.CHANNEL) continue;
    by.set(String(r.CHANNEL), [Math.trunc(r.REPEATED ?? 0), Math.trunc(r.ELIGIBLE ?? 0)]);
  }
  const e = by.get("embed");
  const d = by.get("di");
  if (!e || !d || e[1] === 0 || d[1] === 0) return null;
  return { embed: e[0] / e[1], di: d[0] / d[1], embed_n: e[1], di_n: d[1] };
}

/**
 * Resident continuity rate per channel: of the residents paying in a BP month, the share who also
 * paid the month before (HAS_BILL_PAID AND HAS_BILL_PAID_PREVIOUS_MONTH over HAS_BILL_PAID,
 * distinct customer x BP month), pooled over the last `windowMonths` BP months ending at the
 * reporting month (live Sep 2026: DI 85.3% vs embed 79.1%). Embed = PMC 2476; DI = every other PMC,
 * in-network direct_integration, not embed-attributed. `embed_n` / `di_n` = distinct payer-months
 * in the denominator. Cached 6h; an empty result is not cached (retried next call). Slide 73 prints
 * it as "Residents stick: {di} ... vs {embed} on embed."
 */
export async function pullChannelRepeatRates(
  sf: SnowflakeClient,
  windowMonths = 6,
  today: Date = new Date(),
): Promise<ChannelRepeatRates | null> {
  const rpt = latestEmbedBpMonth(today);
  return cached<ChannelRepeatRates>(`repeat|${rpt}|${Math.trunc(windowMonths)}`, () =>
    runRepeatRates(sf, windowMonths, rpt),
  );
}

// ─── NIRO contrast ─────────────────────────────────────────────────────────────

export interface NiroSnapshot {
  niro_units: number;
  niro_rate: number;
  niro_properties: number;
}

const NiroRowSchema = z.object({
  UNITS: z.coerce.number().nullable(),
  BILLS: z.coerce.number().nullable(),
  PROPERTIES: z.coerce.number().nullable(),
});

/**
 * The optional "you already have X units in network at Y%" line (slide 73): this PMC's in-network
 * rows in PROPERTY_BP_MONTH_STATS at the reporting month, matched on PMC_NAME (Harmoniq: 958
 * flex_anywhere units at 0.7%). null when nothing is in network.
 */
export async function pullNiroSnapshot(
  sf: SnowflakeClient,
  pmcName: string,
  today: Date = new Date(),
): Promise<NiroSnapshot | null> {
  const sql = `
        SELECT SUM(PROPERTY_UNIT_COUNT)           AS UNITS,
               SUM(BILLS_PAID_COUNT)              AS BILLS,
               COUNT(DISTINCT PROPERTY_PUBLIC_ID) AS PROPERTIES
        FROM ${BP}
        WHERE UPPER(PMC_NAME) = UPPER(?)
          AND BP_MONTH = ?
          AND IS_IN_NETWORK = TRUE
    `;
  const rows = await sf.query(sql, NiroRowSchema, [pmcName, latestEmbedBpMonth(today)], {
    label: "Pull NIRO snapshot for the embed PMC",
  });
  if (rows.length === 0) return null;
  const units = Math.trunc(rows[0].UNITS ?? 0);
  if (units <= 0) return null;
  const bills = Math.trunc(rows[0].BILLS ?? 0);
  return { niro_units: units, niro_rate: bills / units, niro_properties: Math.trunc(rows[0].PROPERTIES ?? 0) };
}

// ─── Salesforce total units ────────────────────────────────────────────────────

const SF_ACCOUNT = "EXTERNAL_DATA.POLYTOMIC.SALESFORCE_ACCOUNT";

const SfUnitsSchema = z.object({ TOTAL_UNITS: z.coerce.number().nullable() });

/**
 * TOTAL_COMPANY_UNITS__C for the SF account whose name matches the resolved display name exactly
 * (case-insensitive) - the second link in the Embed deck's total-units chain (Flask
 * `_embed_total_units`, which filters `search_sf_accounts(name)` down to an exact name match).
 * Same account filters as search-prospect-accounts.ts (Prospect OR Partner, PMC, not Deep SMB).
 * null when there is no exact match with a positive unit count.
 */
export async function pullSfTotalUnits(sf: SnowflakeClient, pmcDisplayName: string): Promise<number | null> {
  const sql = `
        SELECT a.TOTAL_COMPANY_UNITS__C AS TOTAL_UNITS
        FROM ${SF_ACCOUNT} a
        WHERE a.ISDELETED = FALSE
          AND a.ACCOUNT_STATUS__C IN ('Prospect', 'Partner')
          AND a.TYPE = 'PMC'
          AND (a.SALES_SEGMENT__C IS NULL OR a.SALES_SEGMENT__C != 'Deep SMB')
          AND UPPER(TRIM(a.NAME)) = UPPER(TRIM(?))
          AND a.TOTAL_COMPANY_UNITS__C > 0
        ORDER BY a.TOTAL_COMPANY_UNITS__C DESC
        LIMIT 1
    `;
  const rows = await sf.query(sql, SfUnitsSchema, [pmcDisplayName], {
    label: "Pull SF TOTAL_COMPANY_UNITS__C for the embed PMC (exact name match)",
  });
  const units = rows.length > 0 ? Math.trunc(rows[0].TOTAL_UNITS ?? 0) : 0;
  return units > 0 ? units : null;
}

// ─── Pure helpers (no Snowflake) ───────────────────────────────────────────────

/**
 * States for the Platinum-floor peer match, straight from the dim address rows - unit-share when
 * real unit counts exist, property-count share when they're placeholders (that fallback is
 * summarizeStatesFromProperties' own). Returns its object: included / excluded / basis / ...
 */
export function embedStatesFromDim(properties: EmbedProperty[]): StateSummary {
  const recs = properties
    .filter((p) => p.state)
    .map((p) => ({ state: String(p.state).trim().toUpperCase(), units: p.unit_count ?? 0 }));
  return summarizeStatesFromProperties(recs);
}

const UNIT_COL_RE = /unit/;

function uploadUnits(row: Record<string, unknown>): number | null {
  for (const [k, v] of Object.entries(row)) {
    if (UNIT_COL_RE.test(String(k).trim().toLowerCase())) {
      const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(n) && Math.trunc(n) > 1) return Math.trunc(n);
    }
  }
  return null;
}

/**
 * Optional New Logo-style property list (the same {header: cell} rows the prospect form posts):
 * matched to the dim rows on normalized property name (Property Name / Property / Name column),
 * overriding address / city / state / zip when the upload carries them and unit_count when a
 * units-like column parses > 1. Unmatched upload rows are ignored; dim rows never dropped.
 */
export function applyPropertyUpload(
  properties: EmbedProperty[],
  uploadRows: Record<string, unknown>[] | null | undefined,
): EmbedProperty[] {
  if (!uploadRows || uploadRows.length === 0) return properties;
  const out = properties.map((p) => ({ ...p }));
  const byName = new Map<string, number>();
  out.forEach((p, i) => byName.set(String(p.property_name).trim().toLowerCase(), i));
  for (const row of uploadRows) {
    const cols = new Map<string, string>();
    for (const k of Object.keys(row)) cols.set(String(k).trim().toLowerCase(), k);
    const nameCol = cols.get("property name") ?? cols.get("property") ?? cols.get("name");
    if (!nameCol) continue;
    const idx = byName.get(String(row[nameCol] ?? "").trim().toLowerCase());
    if (idx === undefined) continue;
    const streetCol = cols.get("street") ?? cols.get("address");
    const street = streetCol ? String(row[streetCol] ?? "").trim() : "";
    if (street) out[idx].address = street;
    for (const key of ["city", "state", "zip"] as const) {
      const col = cols.get(key);
      if (!col) continue;
      const val = String(row[col] ?? "").trim();
      if (!val) continue;
      out[idx][key] = key === "state" ? val.toUpperCase() : key === "zip" ? val.slice(0, 5) : val;
    }
    const units = uploadUnits(row);
    if (units !== null) out[idx].unit_count = units;
  }
  return out;
}

export type EmbedUploadRow = ParsedProperty & { property_public_id: string };

/**
 * The dim rows in the shape the market-map pipeline expects (assignMarkets -> DMA per property),
 * carrying property_public_id so the caller can map geocoded rows back to their embed activity.
 *
 * Deviation from Flask (noted in the parity doc): Flask pre-combines "street, city, ST ZIP" into
 * one Address cell because `parse_property_upload` keeps only {property_name, address}. Clark's
 * `assignMarkets` takes csvZip / csvState fallbacks directly, so the ZIP and state are passed as
 * their own fields (same DMA assignment, no string round-trip) while `address` keeps the combined
 * form for geocoding.
 */
export function embedUploadRows(properties: EmbedProperty[]): EmbedUploadRow[] {
  return properties.map((p) => {
    const stateZip = [String(p.state || "").trim(), String(p.zip || "").trim()].filter(Boolean).join(" ");
    const segments = [String(p.address || "").trim(), String(p.city || "").trim(), stateZip].filter(Boolean);
    return {
      property_name: String(p.property_name || ""),
      address: segments.join(", "),
      units: p.unit_count ?? 0,
      csvZip: String(p.zip || "").trim(),
      csvState: String(p.state || "").trim().toUpperCase(),
      property_public_id: p.property_public_id,
    };
  });
}

/**
 * Slide 74's own market list: one market per DMA holding >= minProperties of THEIR properties
 * (never "Unknown"), ranked by their units desc then property count desc. Same `Market` shape
 * groupPropertiesByMarket returns, so pullMarketSummary / renderMarketMap consume it unchanged.
 * [] = the slide self-gates.
 */
export function embedMarkets(
  withMarket: { dma?: string | null; units?: number | null }[],
  minProperties: number = MARKET_MIN_PROPERTIES,
): Market[] {
  const byDma = new Map<string, { units: number; count: number }>();
  for (const p of withMarket) {
    const dma = p.dma || "Unknown";
    if (dma === "Unknown") continue;
    const d = byDma.get(dma) ?? { units: 0, count: 0 };
    d.units += Math.trunc(Number(p.units ?? 0)) || 0;
    d.count += 1;
    byDma.set(dma, d);
  }
  return [...byDma.entries()]
    .filter(([, d]) => d.count >= minProperties)
    .sort((a, b) => (b[1].units - a[1].units) || (b[1].count - a[1].count) || a[0].localeCompare(b[0]))
    .map(([dma, d]) => ({ label: dma, sub_markets: [dma], rows_per_sub_market: 6, prospect_units: d.units }));
}

export interface EmbedProjectionRange {
  today: number;
  floor_residents: number;
  ceiling_residents: number | null;
  floor_already_here: boolean;
  range_lo: number;
  range_hi: number;
  floor_gain: number;
  ceiling_gain: number;
  rent_lo: number;
  rent_hi: number;
}

/**
 * Slide 73 math (spec decision 2): floor = Platinum peer median x units, ceiling = the graduation
 * cohort's ending adoption x units; the range never starts below today.
 */
export function embedProjectionRange(
  todayPaying: number,
  totalUnits: number,
  floorRate: number,
  ceilingRate: number | null,
  avgRent: number,
): EmbedProjectionRange {
  const today = Math.trunc(todayPaying || 0);
  const units = Math.trunc(totalUnits || 0);
  const floorRes = Math.round((Number(floorRate) || 0) * units);
  const ceilingRes = ceilingRate === null || ceilingRate === undefined
    ? null
    : Math.max(Math.round(Number(ceilingRate) * units), floorRes);
  const rangeLo = Math.max(today, floorRes);
  const rangeHi = Math.max(ceilingRes !== null ? ceilingRes : rangeLo, rangeLo);
  const rent = Number(avgRent) || 0;
  return {
    today,
    floor_residents: floorRes,
    ceiling_residents: ceilingRes,
    floor_already_here: floorRes <= today,
    range_lo: rangeLo,
    range_hi: rangeHi,
    floor_gain: rangeLo - today,
    ceiling_gain: rangeHi - today,
    rent_lo: (rangeLo - today) * rent,
    rent_hi: (rangeHi - today) * rent,
  };
}

// ─── Prospect-deck embed usage (Flask prospect.pull_embed_usage) ───────────────

/** Flask `pull_embed_usage`'s return shape (slides-prospect.ts `EmbedData`). */
export interface EmbedUsage {
  pmc_name: string;
  unit_count: number;
  property_count: number;
  charged_users: number;
  bills_paid: number;
  msp: string;
  bp_month: string;
}

/**
 * Free-text PMS label -> one of the four MSPs that have embed tables, or null (Flask
 * `pull_embed_usage`'s opening substring ladder: yardi / appfolio / mri / zego, anything else
 * returns `{}` and the slide is skipped).
 */
export function embedMspFromPms(pms: string | null | undefined): string | null {
  const p = String(pms ?? "").toLowerCase();
  for (const msp of ["yardi", "appfolio", "mri", "zego"]) {
    if (p.includes(msp)) return msp;
  }
  return null;
}

// Fuzzy name search per MSP, used to turn a free-text prospect name into the canonical source
// name `resolveEmbedPmc` matches exactly. Flask searched the MSP list with `ILIKE '%name%'` and
// took a single LIMIT 1 row; this keeps the ILIKE but returns up to CANDIDATE_LIMIT candidates
// (exact match first, then largest) so the caller can fall through when the top one resolves to
// no live properties - strictly more forgiving than Flask's one shot.
//
// Every list read is anchored to the LIST'S OWN latest snapshot, `month = (SELECT MAX(month) FROM
// <list>)`, NOT the reporting month. The MSP snapshots lag the stats table by 2-4 months (live
// 2026-09-11: Yardi 2026-07-01, MRI / Zego 2026-05-01 vs stats 2026-09-01), so Flask's
// `month = %(bp_month)s` matches zero rows and silently drops its own embed slide for every
// Yardi / MRI / Zego prospect. Same anchoring RESOLVE_SQL / LIST_SQL above already use.
// Bind order per branch: [namePattern, pickedName] (appfolio takes the pattern twice).
const CANDIDATE_LIMIT = 3;

const USAGE_NAME_SQL: Record<string, string> = {
  yardi: `
        SELECT client_name AS NAME, SUM(TO_DECIMAL(unit_count)) AS UNITS
        FROM ${LIST_YARDI}
        WHERE client_name ILIKE ? AND month = (SELECT MAX(month) FROM ${LIST_YARDI})
        GROUP BY client_name
        ORDER BY (UPPER(client_name) = UPPER(?)) DESC, UNITS DESC NULLS LAST
        LIMIT ${CANDIDATE_LIMIT}
    `,
  appfolio: `
        SELECT company_name AS NAME, COUNT(*) AS UNITS
        FROM ${TOGGLE}
        WHERE (company_name ILIKE ? OR vhost ILIKE ?)
          AND company_name IS NOT NULL
          AND NOT (company_name ILIKE 'PRACTICE SITE%' OR vhost ILIKE 'PRACTICE SITE%')
        GROUP BY company_name
        ORDER BY (UPPER(company_name) = UPPER(?)) DESC, UNITS DESC NULLS LAST
        LIMIT ${CANDIDATE_LIMIT}
    `,
  mri: `
        SELECT TRIM(pmc_name) AS NAME, SUM(unit_count) AS UNITS
        FROM ${LIST_MRI}
        WHERE pmc_name ILIKE ? AND month = (SELECT MAX(month) FROM ${LIST_MRI})
        GROUP BY TRIM(pmc_name)
        ORDER BY (UPPER(TRIM(pmc_name)) = UPPER(?)) DESC, UNITS DESC NULLS LAST
        LIMIT ${CANDIDATE_LIMIT}
    `,
  zego: `
        SELECT pmc_company AS NAME, SUM(unit_count) AS UNITS
        FROM ${LIST_ZEGO}
        WHERE pmc_company ILIKE ? AND month = (SELECT MAX(month) FROM ${LIST_ZEGO})
        GROUP BY pmc_company
        ORDER BY (UPPER(pmc_company) = UPPER(?)) DESC, UNITS DESC NULLS LAST
        LIMIT ${CANDIDATE_LIMIT}
    `,
};

const UsageNameSchema = z.object({
  NAME: z.string().nullable(),
  UNITS: z.coerce.number().nullable(),
});

/**
 * Canonical source-name candidates for a free-text prospect name, best first. Exported for the
 * unit tests (and because the Embed deck's picker may want the same fuzzy step later).
 */
export async function findEmbedNameCandidates(
  sf: SnowflakeClient,
  msp: string,
  prospectName: string,
): Promise<string[]> {
  const sql = USAGE_NAME_SQL[msp];
  if (!sql) return [];
  const picked = String(prospectName ?? "").trim();
  if (!picked) return [];
  const pattern = `%${picked}%`;
  const binds = msp === "appfolio" ? [pattern, pattern, picked] : [pattern, picked];
  const rows = await sf.query(sql, UsageNameSchema, binds, { label: `Find embed PMC name (${msp})` });
  const out: string[] = [];
  for (const r of rows) {
    const nm = String(r.NAME ?? "").trim();
    if (nm && isRealPmcName(nm) && !out.includes(nm)) out.push(nm);
  }
  return out;
}

/**
 * A prospect's CURRENT out-of-network embed usage — the data behind the prospect deck's Embed
 * Activation slide (`renderEmbedActivation`). Clark port of Flask `prospect.pull_embed_usage`
 * (generator/prospect.py:1215).
 *
 * Rather than re-copying Flask's four per-MSP mega-queries, this composes the three pieces
 * `embed.ts` already owns and unit-tests:
 *   1. `findEmbedNameCandidates` — Flask's ILIKE name search, anchored at the list's own
 *      MAX(month) (the lag fix Flask still lacks; see the comment above USAGE_NAME_SQL).
 *   2. `resolveEmbedPmc` — the canonical name -> live dim property rows + the MSP list's
 *      SUM(unit_count) (`list_unit_total`). One source of truth for the join paths.
 *   3. `pullEmbedMonthly` — per-(month, property) CHARGED_USERS / BILLS_PAID from the stats
 *      table, summed at the reporting month.
 *
 * `property_count` is therefore always the count of LIVE dim properties (what Flask's AppFolio
 * and Zego branches already did) rather than raw MSP-list rows (what its Yardi and MRI branches
 * did) — the same figure the Embed deck prints, and the honest one for "Properties live".
 *
 * Returns null — so the caller renders no slide — when the PMS has no embed tables, the name
 * matches nothing, or no live embed properties resolve. A resolved PMC with zero billed
 * residents this month still returns null: a slide headed "Flex is already working at your
 * properties" with 0 residents is worse than no slide (Flask's `if embed_data:` gate had the
 * same practical effect only by accident, via the LEFT JOIN COALESCE'ing to 0).
 */
export async function pullEmbedUsage(
  sf: SnowflakeClient,
  pms: string | null | undefined,
  prospectName: string,
  today: Date = new Date(),
): Promise<EmbedUsage | null> {
  const msp = embedMspFromPms(pms);
  if (!msp) return null;

  const bpMonth = latestEmbedBpMonth(today);
  const candidates = await findEmbedNameCandidates(sf, msp, prospectName);
  if (candidates.length === 0) return null;

  for (const name of candidates) {
    const resolved = await resolveEmbedPmc(sf, name);
    if (!resolved || resolved.properties.length === 0) continue;
    const ids = resolved.properties.map((p) => p.property_public_id);
    // lookback 2 (not 1) so the reporting month is safely inside the window whatever day of the
    // month this runs on; the filter below picks the one month the slide states.
    const monthly = await pullEmbedMonthly(sf, ids, 2, today);
    let chargedUsers = 0;
    let billsPaid = 0;
    for (const m of monthly) {
      if (m.bp_month !== bpMonth) continue;
      chargedUsers += m.charged_users;
      billsPaid += m.bills_paid;
    }
    if (chargedUsers <= 0 && billsPaid <= 0) continue;
    return {
      pmc_name: resolved.pmc_display_name,
      unit_count: resolved.list_unit_total ?? 0,
      property_count: resolved.properties.length,
      charged_users: chargedUsers,
      bills_paid: billsPaid,
      msp: resolved.msp,
      bp_month: bpMonth,
    };
  }
  return null;
}

/** Exported for the orchestration's month arithmetic (reporting month labels). */
export { shiftMonth as _shiftMonth };
