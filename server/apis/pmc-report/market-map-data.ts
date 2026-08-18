/**
 * Market Map data layer.
 * Parses property uploads, assigns DMAs, groups markets, pulls network pins,
 * applies outlier filtering, and computes annual guarantee ranking.
 *
 * All Snowflake queries accept an integration client (`ctx.integrations.snowflake_sso`).
 */

import { z } from "@superblocksteam/sdk-api";
import type { GeoResult } from "./market-map-geocode.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedProperty {
  property_name: string;
  address: string;
  units: number;
  /** Zip extracted directly from CSV (5-digit), used as fallback when geocoding fails */
  csvZip?: string;
  /** State extracted directly from CSV (2-letter code), used as fallback when geocoding fails */
  csvState?: string;
}

/** TEMPORARY diagnostic — surfaces exactly what parsePropertyUpload actually saw/matched, so a
 * units total that doesn't match a manual count (or a units column that silently isn't found)
 * is visible instead of guessed at. Kevin reported the export's own "# of Units" column sums to
 * ~837 by hand but the app computed 617 for the same market. */
export interface UploadParseDiagnostic {
  headers_seen: string[];
  address_col: string | null;
  street_col: string | null;
  city_col: string | null;
  state_col: string | null;
  zip_col: string | null;
  units_col: string | null;
  name_col: string | null;
  rows_in_sheet: number;
  rows_parsed: number;
  rows_dropped_no_address: number;
  rows_trimmed_by_max_properties: number;
  total_units_parsed: number;
}

export interface GeocodedProperty extends ParsedProperty {
  lat: number;
  lon: number;
  zip: string;
  state: string;
  dma: string;
}

export interface Market {
  label: string;
  sub_markets: string[];
  rows_per_sub_market: number;
  prospect_units: number;
}

export interface MarketSummaryCore {
  total_properties: number;
  total_pmcs: number;
  total_units: number;
  total_active_users: number;
  avg_adoption: number;
  rent_paid_month: number;
  total_rent_paid_all_time: number;
  new_properties_this_year: number;
  new_pmcs_this_year: number;
  new_properties_rent_paid: number;
}

export interface SimilarityInfo {
  tier: "rent+size" | "rent" | "all";
  label: string;
  is_fallback: boolean;
  rent_low: number;
  rent_high: number;
  unit_low: number | null;
  unit_high: number | null;
  pool_properties: number;
  unknown_rent_properties: number;
}

export interface MarketSummary extends MarketSummaryCore {
  /** Always-unfiltered market-wide totals (for "X properties in Y" context) */
  market_wide?: MarketSummaryCore;
  /** Similarity tier info — null when no avg_rent provided */
  similarity?: SimilarityInfo | null;
}

export interface NetworkPin {
  property_name: string;
  lat: number;
  lon: number;
  is_new_this_year: boolean;
}

export interface ProspectPin {
  property_name: string;
  lat: number;
  lon: number;
}

export interface MarketGuarantee {
  annual_guarantee: number;
  avg_rent: number;
  avg_rent_is_market_fallback: boolean;
  show_guarantee: boolean;
}

// ─── Snowflake client type (minimal) ────────────────────────────────────────

interface SnowflakeClient {
  query<T>(sql: string, schema: z.ZodType<T>, params?: unknown[], meta?: { label?: string }): Promise<T[]>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const NETWORK_PIN_DISPLAY_CAP = 300;
const NETWORK_PIN_FETCH_STEPS = [330, 600, 1200, 2500];
const MARKET_THRESHOLD = 500;
const FALLBACK_TOP_N = 3;
const MAX_PROPERTIES = 250;

// ─── 1. Parse Upload ────────────────────────────────────────────────────────

/** Detect header row in a worksheet (skip leading title/note rows). */
function detectHeaderRow(rows: string[][]): number {
  const headerKeywords = ["address", "street", "city", "state", "zip", "units", "property"];
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = rows[i].map(c => (c || "").toLowerCase());
    const matches = cells.filter(c => headerKeywords.some(k => c.includes(k)));
    if (matches.length >= 1) return i;
  }
  return 0; // default to first row
}

/** Parse CSV text into row objects (simple inline parser). */
function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length < 2) return [];

  // Simple CSV parsing supporting quoted fields
  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]);
  const results: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    results.push(row);
  }
  return results;
}

/**
 * Parse Excel from base64 — basic .xlsx support (multi-sheet with header detection).
 * ALN exports often have a cover/summary sheet first with the actual data on sheet 2+.
 * We iterate all sheets and pick the first one that has recognized column headers.
 * Since the SDK runtime may not have xlsx available, we handle this as a
 * fallback: attempt dynamic import, return empty on failure (soft-fail per spec).
 */
async function parseExcelBase64(base64: string): Promise<Record<string, string>[]> {
  try {
    const XLSX = await import("xlsx");
    const buffer = Buffer.from(base64, "base64");
    const wb = XLSX.read(buffer, { type: "buffer" });
    if (wb.SheetNames.length === 0) return [];

    // Try each sheet in order — pick the first one where header detection succeeds
    // with at least one recognized property-data keyword.
    const headerKeywords = ["address", "street", "city", "state", "zip", "units", "property"];
    let bestSheet: string | null = null;
    let bestRows: string[][] = [];
    let bestHeaderIdx = 0;

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rawRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
      if (rawRows.length < 2) continue;

      const headerIdx = detectHeaderRow(rawRows);
      const headerCells = (rawRows[headerIdx] || []).map(c => (c || "").toLowerCase());
      const matchCount = headerCells.filter(c => headerKeywords.some(k => c.includes(k))).length;
      if (matchCount >= 2) {
        // Strong match — use this sheet
        bestSheet = sheetName;
        bestRows = rawRows;
        bestHeaderIdx = headerIdx;
        break;
      } else if (matchCount >= 1 && !bestSheet) {
        // Weak match — use as fallback if no stronger match found
        bestSheet = sheetName;
        bestRows = rawRows;
        bestHeaderIdx = headerIdx;
      }
    }

    // Fall back to first sheet if no header match found on any sheet
    if (!bestSheet) {
      bestSheet = wb.SheetNames[0];
      const sheet = wb.Sheets[bestSheet];
      bestRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
      bestHeaderIdx = detectHeaderRow(bestRows);
    }

    if (bestRows.length < 2) return [];

    const headers = bestRows[bestHeaderIdx].map(h => String(h || "").trim());
    const dataRows = bestRows.slice(bestHeaderIdx + 1);

    return dataRows
      .filter(row => row.some(cell => cell != null && String(cell).trim() !== ""))
      .map(row => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = String(row[i] ?? "").trim();
        });
        return obj;
      });
  } catch {
    // xlsx not available in this runtime — caller should have sent CSV from client
    return [];
  }
}

/** Find a column by substring match (case-insensitive). */
function findColumn(headers: string[], ...keywords: string[]): string | null {
  for (const kw of keywords) {
    const found = headers.find(h => h.toLowerCase().includes(kw.toLowerCase()));
    if (found) return found;
  }
  return null;
}

/** Parse property rows from raw upload data. Returns the parsed properties plus a diagnostic
 * of exactly what columns were detected/used, so a units total that looks wrong is traceable
 * instead of guessed at. */
export function parsePropertyUpload(
  rows: Record<string, string>[]
): { properties: ParsedProperty[]; diagnostic: UploadParseDiagnostic } {
  const emptyDiagnostic: UploadParseDiagnostic = {
    headers_seen: [], address_col: null, street_col: null, city_col: null, state_col: null,
    zip_col: null, units_col: null, name_col: null, rows_in_sheet: 0, rows_parsed: 0,
    rows_dropped_no_address: 0, rows_trimmed_by_max_properties: 0, total_units_parsed: 0,
  };
  if (rows.length === 0) return { properties: [], diagnostic: emptyDiagnostic };

  const headers = Object.keys(rows[0]);
  const addressCol = findColumn(headers, "address");
  const streetCol = findColumn(headers, "street");
  const cityCol = findColumn(headers, "city");
  const stateCol = findColumn(headers, "state");
  const zipCol = findColumn(headers, "zip", "postal");
  const unitsCol = findColumn(headers, "unit");
  const nameCol = findColumn(headers, "property name", "property", "name");

  const properties: ParsedProperty[] = [];
  let droppedNoAddress = 0;

  for (const row of rows) {
    let address = "";
    if (addressCol && row[addressCol]?.trim()) {
      address = row[addressCol].trim();
    } else {
      // Build from components
      const parts: string[] = [];
      if (streetCol && row[streetCol]?.trim()) parts.push(row[streetCol].trim());
      if (cityCol && row[cityCol]?.trim()) parts.push(row[cityCol].trim());
      if (stateCol && row[stateCol]?.trim()) parts.push(row[stateCol].trim());
      if (zipCol && row[zipCol]?.trim()) parts.push(row[zipCol].trim());
      address = parts.join(", ");
    }

    if (!address) { droppedNoAddress++; continue; }

    const units = unitsCol ? parseUnits(row[unitsCol]) : 0;
    const property_name = nameCol ? (row[nameCol] || "").trim() : "";

    // Extract zip and state directly from CSV for fallback when geocoding fails
    const csvZip = zipCol ? normalizeZip5(row[zipCol] || "") : "";
    const csvState = stateCol ? (row[stateCol] || "").trim().toUpperCase().slice(0, 2) : "";

    properties.push({
      property_name,
      address,
      units,
      ...(csvZip.length === 5 ? { csvZip } : {}),
      ...(csvState.length === 2 ? { csvState } : {}),
    });
  }

  const rowsParsedBeforeTrim = properties.length;
  const totalUnitsParsed = properties.reduce((s, p) => s + p.units, 0);

  // Trim to MAX_PROPERTIES by unit count
  let trimmedCount = 0;
  let finalProperties = properties;
  if (properties.length > MAX_PROPERTIES) {
    properties.sort((a, b) => b.units - a.units);
    trimmedCount = properties.length - MAX_PROPERTIES;
    finalProperties = properties.slice(0, MAX_PROPERTIES);
  }

  return {
    properties: finalProperties,
    diagnostic: {
      headers_seen: headers,
      address_col: addressCol,
      street_col: streetCol,
      city_col: cityCol,
      state_col: stateCol,
      zip_col: zipCol,
      units_col: unitsCol,
      name_col: nameCol,
      rows_in_sheet: rows.length,
      rows_parsed: rowsParsedBeforeTrim,
      rows_dropped_no_address: droppedNoAddress,
      rows_trimmed_by_max_properties: trimmedCount,
      total_units_parsed: totalUnitsParsed,
    },
  };
}

function parseUnits(val: string | undefined | null): number {
  if (!val) return 0;
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Top-level upload parser: handles CSV text or Excel base64. */
export async function parseUpload(
  content: string,
  filename: string
): Promise<{ properties: ParsedProperty[]; diagnostic: UploadParseDiagnostic }> {
  const ext = filename.toLowerCase().split(".").pop() || "";
  let rows: Record<string, string>[];

  if (ext === "xlsx" || ext === "xls") {
    rows = await parseExcelBase64(content);
  } else {
    // CSV / TSV — treat as text
    rows = parseCsvText(content);
  }

  return parsePropertyUpload(rows);
}

// ─── 2. Assign DMA ──────────────────────────────────────────────────────────

function normalizeZip5(zip: string): string {
  return (zip || "").trim().replace(/[^0-9]/g, "").slice(0, 5);
}

const DmaRow = z.object({
  ZIP_CODE: z.string(),
  DMA_NAME: z.string(),
});

export async function assignMarkets(
  properties: Array<ParsedProperty & Partial<GeoResult>>,
  sfClient: SnowflakeClient
): Promise<GeocodedProperty[]> {
  // Collect valid zips — use geocoded zip first, then CSV zip as fallback
  const zips = [...new Set(
    properties
      .map(p => normalizeZip5(p.zip || p.csvZip || ""))
      .filter(z => z.length === 5)
  )];

  let zipToDma: Record<string, string> = {};

  if (zips.length > 0) {
    const placeholders = zips.map(() => "?").join(", ");
    const sql = `
      SELECT ZIP_CODE, DMA_NAME
      FROM PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING
      WHERE ZIP_CODE IN (${placeholders})
    `;
    try {
      const rows = await sfClient.query(sql, DmaRow, zips, {
        label: "Map ZIPs to DMAs",
      });
      for (const r of rows) {
        zipToDma[r.ZIP_CODE] = r.DMA_NAME;
      }
    } catch (e) {
      // Soft-fail: unknown DMA for all
    }
  }

  return properties.map(p => {
    const effectiveZip = normalizeZip5(p.zip || p.csvZip || "");
    const effectiveState = p.state || p.csvState || "";
    return {
      property_name: p.property_name,
      address: p.address,
      units: p.units,
      // `?? 0` used to silently place any property whose geocoding failed at (0, 0) — the
      // Gulf of Guinea, a real but completely wrong location that still passes
      // Number.isFinite(). If MULTIPLE properties in one upload all fail geocoding (e.g. a
      // batch of malformed/unrecognized addresses), they'd all stack on that exact point:
      // the map zooms to open ocean (shows as solid blue, looking like tiles aren't loading),
      // and every real nearby network pin gets filtered out by filterPinsNearAny's 35-mile
      // radius since the "reference" point is thousands of miles from the real market.
      // NaN is the correct sentinel here instead: pinsCentroid, filterPinsByDistance, and
      // filterPinsNearAny (market-map-data.ts) already explicitly filter to
      // Number.isFinite(lat/lon) before using coordinates, and the client-side pin renderer
      // (market-map-slides.ts's isFinitePin) already does the same — NaN correctly drops
      // these properties from the MAP (no pin plotted, since we don't know where they are)
      // without touching their unit/property counts anywhere else, and with zero changes
      // needed to any of that already-correct downstream filtering.
      lat: p.lat ?? NaN,
      lon: p.lon ?? NaN,
      zip: effectiveZip,
      state: effectiveState,
      dma: zipToDma[effectiveZip] || "Unknown",
    };
  });
}

// ─── 3. Group by market ─────────────────────────────────────────────────────

export function groupPropertiesByMarket(
  properties: GeocodedProperty[],
  threshold = MARKET_THRESHOLD,
  fallbackTopN = FALLBACK_TOP_N
): Market[] {
  const byDma: Record<string, number> = {};
  for (const p of properties) {
    if (p.dma === "Unknown") continue;
    byDma[p.dma] = (byDma[p.dma] || 0) + p.units;
  }

  let qualifying = Object.entries(byDma).filter(([, u]) => u >= threshold);
  if (qualifying.length === 0) {
    // Fallback: top N by unit count
    qualifying = Object.entries(byDma)
      .sort(([, a], [, b]) => b - a)
      .slice(0, fallbackTopN);
  }

  // merges=[] always for New Logo deck — each DMA is its own market
  return qualifying.map(([dma, units]) => ({
    label: dma,
    sub_markets: [dma],
    rows_per_sub_market: 6,
    prospect_units: units,
  }));
}

// ─── 4. Market summary query (with similarity tiering) ──────────────────────

const SummaryTierRow = z.object({
  TIER: z.string(),
  TOTAL_PROPERTIES: z.coerce.number(),
  TOTAL_PMCS: z.coerce.number(),
  TOTAL_UNITS: z.coerce.number(),
  TOTAL_BILLS_PAID: z.coerce.number(),
  TOTAL_ACTIVE_USERS: z.coerce.number(),
  UNKNOWN_RENT_PROPERTIES: z.coerce.number(),
  RENT_PAID_MONTH: z.coerce.number(),
  TOTAL_RENT_PAID_ALL_TIME: z.coerce.number(),
  NEW_PROPERTIES_THIS_YEAR: z.coerce.number(),
  NEW_PMCS_THIS_YEAR: z.coerce.number(),
  NEW_PROPERTIES_RENT_PAID: z.coerce.number(),
});

/** Aggregation SELECT fragment shared across all 3 tiers (UNION ALL) */
const MARKET_SIMILARITY_AGG_SQL = `
  COUNT(DISTINCT PROPERTY_PUBLIC_ID)                                          AS TOTAL_PROPERTIES,
  COUNT(DISTINCT PMC_NAME)                                                    AS TOTAL_PMCS,
  COALESCE(SUM(PROPERTY_UNIT_COUNT), 0)                                      AS TOTAL_UNITS,
  COALESCE(SUM(BILLS_PAID_COUNT), 0)                                         AS TOTAL_BILLS_PAID,
  COALESCE(SUM(CHARGED_USERS_COUNT), 0)                                      AS TOTAL_ACTIVE_USERS,
  COUNT(DISTINCT CASE WHEN RENT_VALUE IS NULL THEN PROPERTY_PUBLIC_ID END)    AS UNKNOWN_RENT_PROPERTIES,
  COALESCE(SUM(RENT_PAID_THIS_MONTH), 0)                                     AS RENT_PAID_MONTH,
  COALESCE(SUM(ALL_TIME_RENT), 0)                                            AS TOTAL_RENT_PAID_ALL_TIME,
  COUNT(DISTINCT CASE WHEN ROLLOUT_MONTH >= ? THEN PROPERTY_PUBLIC_ID END)    AS NEW_PROPERTIES_THIS_YEAR,
  COUNT(DISTINCT CASE WHEN ROLLOUT_MONTH >= ? THEN PMC_NAME END)              AS NEW_PMCS_THIS_YEAR,
  COALESCE(SUM(CASE WHEN ROLLOUT_MONTH >= ? THEN ALL_TIME_RENT ELSE 0 END), 0) AS NEW_PROPERTIES_RENT_PAID
`;

const MIN_COMPARABLE_PROPERTIES = 40;
const RENT_BAND = 0.30;
const SIZE_BAND: [number, number] = [0.5, 2.0];

export interface PullMarketSummaryOptions {
  avgRent?: number;
  avgUnitsPerProperty?: number;
}

export async function pullMarketSummary(
  dmaName: string,
  bpMonth: string,
  yearStart: string,
  sfClient: SnowflakeClient,
  options: PullMarketSummaryOptions = {}
): Promise<MarketSummary> {
  const { avgRent = 0, avgUnitsPerProperty = 0 } = options;

  // Compute rent/size bands
  const rentLow = avgRent > 0 ? avgRent * (1 - RENT_BAND) : 0;
  const rentHigh = avgRent > 0 ? avgRent * (1 + RENT_BAND) : 1e12;
  const unitLow = avgUnitsPerProperty > 0 ? avgUnitsPerProperty * SIZE_BAND[0] : 0;
  const unitHigh = avgUnitsPerProperty > 0 ? avgUnitsPerProperty * SIZE_BAND[1] : 1e9;

  // Single tiered query that computes all 3 populations at once
  const sqlTiers = `
    WITH prop_zip AS (
      SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
             ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
      FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
    ),
    current_snapshot AS (
      SELECT t.PROPERTY_PUBLIC_ID, t.PMC_NAME, t.PROPERTY_UNIT_COUNT, t.BILLS_PAID_COUNT,
             t.CHARGED_USERS_COUNT, t.RENT_PAID_AMOUNT AS RENT_PAID_THIS_MONTH, t.ROLLOUT_MONTH
      FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
      LEFT JOIN prop_zip p ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
      LEFT JOIN PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING dma ON dma.ZIP_CODE = LEFT(p.PROPERTY_ZIP, 5)
      WHERE dma.DMA_NAME = ? AND t.BP_MONTH = ? AND t.IS_IN_NETWORK = TRUE
    ),
    prop_rent AS (
      SELECT PROPERTY_PUBLIC_ID,
             SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(BILLS_PAID_COUNT), 0) AS RENT_VALUE
      FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
      WHERE BP_MONTH BETWEEN DATEADD('month', -11, ?::DATE) AND ?::DATE
      GROUP BY PROPERTY_PUBLIC_ID
    ),
    prop_alltime AS (
      SELECT t2.PROPERTY_PUBLIC_ID, SUM(t2.RENT_PAID_AMOUNT) AS ALL_TIME_RENT
      FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t2
      JOIN current_snapshot cs ON cs.PROPERTY_PUBLIC_ID = t2.PROPERTY_PUBLIC_ID
      GROUP BY t2.PROPERTY_PUBLIC_ID
    ),
    flagged AS (
      SELECT cs.PROPERTY_PUBLIC_ID, cs.PMC_NAME, cs.PROPERTY_UNIT_COUNT, cs.BILLS_PAID_COUNT,
             cs.CHARGED_USERS_COUNT, cs.RENT_PAID_THIS_MONTH, cs.ROLLOUT_MONTH,
             pr.RENT_VALUE, pa.ALL_TIME_RENT,
             (pr.RENT_VALUE IS NULL OR pr.RENT_VALUE BETWEEN ? AND ?) AS IN_RENT_BAND,
             (cs.PROPERTY_UNIT_COUNT BETWEEN ? AND ?) AS IN_SIZE_BAND
      FROM current_snapshot cs
      LEFT JOIN prop_rent pr ON pr.PROPERTY_PUBLIC_ID = cs.PROPERTY_PUBLIC_ID
      LEFT JOIN prop_alltime pa ON pa.PROPERTY_PUBLIC_ID = cs.PROPERTY_PUBLIC_ID
    )
    SELECT 'rent+size' AS TIER, ${MARKET_SIMILARITY_AGG_SQL} FROM flagged WHERE IN_RENT_BAND AND IN_SIZE_BAND
    UNION ALL
    SELECT 'rent' AS TIER, ${MARKET_SIMILARITY_AGG_SQL} FROM flagged WHERE IN_RENT_BAND
    UNION ALL
    SELECT 'all' AS TIER, ${MARKET_SIMILARITY_AGG_SQL} FROM flagged
  `;

  // Params: current_snapshot(dmaName, bpMonth), prop_rent(bpMonth, bpMonth),
  //         flagged(rentLow, rentHigh, unitLow, unitHigh),
  //         then 3x yearStart per UNION ALL tier (3 refs each = 9 total)
  const tierParams = [
    dmaName, bpMonth,                   // current_snapshot
    bpMonth, bpMonth,                   // prop_rent trailing-12mo
    rentLow, rentHigh, unitLow, unitHigh, // flagged bands
    yearStart, yearStart, yearStart,    // tier 1 (rent+size)
    yearStart, yearStart, yearStart,    // tier 2 (rent)
    yearStart, yearStart, yearStart,    // tier 3 (all)
  ];

  const tierRows = await sfClient.query(sqlTiers, SummaryTierRow, tierParams, {
    label: `Market summary (tiered) - ${dmaName}`,
  });

  const tierMap: Record<string, z.infer<typeof SummaryTierRow>> = {};
  for (const row of tierRows) {
    tierMap[row.TIER] = row;
  }

  const ZERO_ROW: z.infer<typeof SummaryTierRow> = {
    TIER: "all", TOTAL_PROPERTIES: 0, TOTAL_PMCS: 0, TOTAL_UNITS: 0, TOTAL_BILLS_PAID: 0,
    TOTAL_ACTIVE_USERS: 0, UNKNOWN_RENT_PROPERTIES: 0, RENT_PAID_MONTH: 0,
    TOTAL_RENT_PAID_ALL_TIME: 0, NEW_PROPERTIES_THIS_YEAR: 0, NEW_PMCS_THIS_YEAR: 0,
    NEW_PROPERTIES_RENT_PAID: 0,
  };

  const allRow = tierMap["all"] || ZERO_ROW;
  const allPropertiesCount = allRow.TOTAL_PROPERTIES || 0;
  const allTotalUnits = allRow.TOTAL_UNITS || 0;

  // market_wide is ALWAYS unfiltered totals
  const marketWide: MarketSummaryCore = {
    total_properties: allPropertiesCount,
    total_pmcs: allRow.TOTAL_PMCS,
    total_units: allTotalUnits,
    total_active_users: allRow.TOTAL_ACTIVE_USERS,
    avg_adoption: allTotalUnits > 0 ? Math.min(1.0, allRow.TOTAL_BILLS_PAID / allTotalUnits) : 0,
    rent_paid_month: allRow.RENT_PAID_MONTH,
    total_rent_paid_all_time: allRow.TOTAL_RENT_PAID_ALL_TIME,
    new_properties_this_year: allRow.NEW_PROPERTIES_THIS_YEAR,
    new_pmcs_this_year: allRow.NEW_PMCS_THIS_YEAR,
    new_properties_rent_paid: allRow.NEW_PROPERTIES_RENT_PAID,
  };

  // Choose best tier that clears min_comparable_properties
  let chosenTier: "rent+size" | "rent" | "all" = "all";
  let chosenRow = allRow;
  if (avgRent > 0 && allPropertiesCount >= MIN_COMPARABLE_PROPERTIES) {
    for (const tname of ["rent+size", "rent"] as const) {
      const trow = tierMap[tname];
      if (trow && trow.TOTAL_PROPERTIES >= MIN_COMPARABLE_PROPERTIES) {
        chosenTier = tname;
        chosenRow = trow;
        break;
      }
    }
  }

  const fieldsFromRow = (row: z.infer<typeof SummaryTierRow>): MarketSummaryCore => {
    const tUnits = row.TOTAL_UNITS || 0;
    const tBills = row.TOTAL_BILLS_PAID || 0;
    return {
      total_properties: row.TOTAL_PROPERTIES,
      total_pmcs: row.TOTAL_PMCS,
      total_units: tUnits,
      total_active_users: row.TOTAL_ACTIVE_USERS,
      avg_adoption: tUnits > 0 ? Math.min(1.0, tBills / tUnits) : 0,
      rent_paid_month: row.RENT_PAID_MONTH,
      total_rent_paid_all_time: row.TOTAL_RENT_PAID_ALL_TIME,
      new_properties_this_year: row.NEW_PROPERTIES_THIS_YEAR,
      new_pmcs_this_year: row.NEW_PMCS_THIS_YEAR,
      new_properties_rent_paid: row.NEW_PROPERTIES_RENT_PAID,
    };
  };

  let similarity: SimilarityInfo | null = null;
  if (avgRent > 0) {
    const isFallback = chosenTier === "all";
    const labels: Record<string, string> = {
      "rent+size": `rent within ${Math.round(RENT_BAND * 100)}% of yours & similar property size`,
      "rent": `rent within ${Math.round(RENT_BAND * 100)}% of yours`,
      "all": allPropertiesCount < MIN_COMPARABLE_PROPERTIES
        ? "market-wide - too few rent-comparable properties in this market to filter"
        : "market-wide",
    };
    similarity = {
      tier: chosenTier,
      label: labels[chosenTier],
      is_fallback: isFallback,
      rent_low: rentLow,
      rent_high: rentHigh,
      unit_low: avgUnitsPerProperty > 0 ? unitLow : null,
      unit_high: avgUnitsPerProperty > 0 ? unitHigh : null,
      pool_properties: chosenRow.TOTAL_PROPERTIES,
      unknown_rent_properties: chosenRow.UNKNOWN_RENT_PROPERTIES,
    };
  }

  return {
    ...fieldsFromRow(chosenRow),
    market_wide: marketWide,
    similarity,
  };
}

// ─── 5. Network pins ────────────────────────────────────────────────────────

const NetworkPinRow = z.object({
  PROPERTY_NAME: z.string().nullable(),
  UNITS: z.coerce.number(),
  LAT: z.coerce.number(),
  LON: z.coerce.number(),
  IS_NEW: z.coerce.number(), // 1 or 0
});

async function pullNetworkPins(
  dmaName: string,
  bpMonth: string,
  yearStart: string,
  cap: number,
  newQuota: number,
  sfClient: SnowflakeClient,
  similarity?: SimilarityInfo | null
): Promise<NetworkPin[]> {
  // Determine if we should apply similarity filtering on pins
  const applyFilter = !!similarity && (similarity.tier === "rent" || similarity.tier === "rent+size");

  if (applyFilter) {
    // Similarity-filtered pin query with prop_rent CTE and rent/size predicates
    const hasSizeBand = similarity!.tier === "rent+size" && similarity!.unit_low != null;
    const sizePredicate = hasSizeBand ? "AND t.PROPERTY_UNIT_COUNT BETWEEN ? AND ?" : "";

    const filteredSql = (rolloutFilter: string, limit: number) => `
      WITH prop_zip AS (
        SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
               ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
        FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
      ),
      prop_rent AS (
        SELECT PROPERTY_PUBLIC_ID,
               SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(BILLS_PAID_COUNT), 0) AS RENT_VALUE
        FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
        WHERE BP_MONTH BETWEEN DATEADD('month', -11, ?::DATE) AND ?::DATE
        GROUP BY PROPERTY_PUBLIC_ID
      )
      SELECT
        t.PROPERTY_NAME                AS PROPERTY_NAME,
        SUM(t.PROPERTY_UNIT_COUNT)     AS UNITS,
        MAX(cd.LATITUDE)               AS LAT,
        MAX(cd.LONGITUDE)              AS LON,
        MAX(CASE WHEN t.ROLLOUT_MONTH >= ? THEN 1 ELSE 0 END) AS IS_NEW
      FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
      LEFT JOIN prop_zip p ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
      LEFT JOIN PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING dma
        ON dma.ZIP_CODE = LEFT(p.PROPERTY_ZIP, 5)
      LEFT JOIN prop_rent pr ON pr.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID
      JOIN PRODUCTION.ANALYTICS.PROPERTY_CENSUS_DISTRICTS cd
        ON cd.PROPERTY_ID = t.PROPERTY_ID
        AND cd.LATITUDE IS NOT NULL AND cd.LONGITUDE IS NOT NULL
      WHERE dma.DMA_NAME = ?
        AND t.BP_MONTH = ?
        AND t.IS_IN_NETWORK = TRUE
        AND ${rolloutFilter}
        AND (pr.RENT_VALUE IS NULL OR pr.RENT_VALUE BETWEEN ? AND ?)
        ${sizePredicate}
      GROUP BY t.PROPERTY_PUBLIC_ID, t.PROPERTY_NAME
      ORDER BY UNITS DESC
      LIMIT ${limit}
    `;

    const buildParams = (rolloutYearStart: string): (string | number)[] => {
      const params: (string | number)[] = [
        bpMonth, bpMonth,               // prop_rent trailing-12mo
        yearStart,                       // IS_NEW check
        dmaName, bpMonth,               // WHERE clause
        rolloutYearStart,               // rollout filter param
        similarity!.rent_low, similarity!.rent_high, // rent band
      ];
      if (hasSizeBand) {
        params.push(similarity!.unit_low!, similarity!.unit_high!);
      }
      return params;
    };

    const newSql = filteredSql("t.ROLLOUT_MONTH >= ?", newQuota);
    const establishedSql = filteredSql("(t.ROLLOUT_MONTH < ? OR t.ROLLOUT_MONTH IS NULL)", Math.max(cap - newQuota, 0));

    const [newRows, estRows] = await Promise.all([
      sfClient.query(newSql, NetworkPinRow, buildParams(yearStart), {
        label: `Network pins filtered (new) - ${dmaName}`,
      }),
      sfClient.query(establishedSql, NetworkPinRow, buildParams(yearStart), {
        label: `Network pins filtered (established) - ${dmaName}`,
      }),
    ]);

    const toPin = (row: z.infer<typeof NetworkPinRow>, isNew: boolean): NetworkPin => ({
      property_name: row.PROPERTY_NAME || "",
      lat: row.LAT,
      lon: row.LON,
      is_new_this_year: isNew,
    });

    return [
      ...newRows.map(r => toPin(r, true)),
      ...estRows.map(r => toPin(r, false)),
    ];
  }

  // Unfiltered path (no similarity or tier="all")
  const baseSql = (rolloutFilter: string, limit: number) => `
    WITH prop_zip AS (
      SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
             ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
      FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
    )
    SELECT
      t.PROPERTY_NAME                AS PROPERTY_NAME,
      SUM(t.PROPERTY_UNIT_COUNT)     AS UNITS,
      MAX(cd.LATITUDE)               AS LAT,
      MAX(cd.LONGITUDE)              AS LON,
      MAX(CASE WHEN t.ROLLOUT_MONTH >= ? THEN 1 ELSE 0 END) AS IS_NEW
    FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
    LEFT JOIN prop_zip p ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
    LEFT JOIN PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING dma
      ON dma.ZIP_CODE = LEFT(p.PROPERTY_ZIP, 5)
    JOIN PRODUCTION.ANALYTICS.PROPERTY_CENSUS_DISTRICTS cd
      ON cd.PROPERTY_ID = t.PROPERTY_ID
      AND cd.LATITUDE IS NOT NULL AND cd.LONGITUDE IS NOT NULL
    WHERE dma.DMA_NAME = ?
      AND t.BP_MONTH = ?
      AND t.IS_IN_NETWORK = TRUE
      AND ${rolloutFilter}
    GROUP BY t.PROPERTY_PUBLIC_ID, t.PROPERTY_NAME
    ORDER BY UNITS DESC
    LIMIT ${limit}
  `;

  const newSql = baseSql("t.ROLLOUT_MONTH >= ?", newQuota);
  const establishedSql = baseSql("(t.ROLLOUT_MONTH < ? OR t.ROLLOUT_MONTH IS NULL)", Math.max(cap - newQuota, 0));

  const [newRows, estRows] = await Promise.all([
    sfClient.query(newSql, NetworkPinRow, [yearStart, dmaName, bpMonth, yearStart], {
      label: `Network pins (new) - ${dmaName}`,
    }),
    sfClient.query(establishedSql, NetworkPinRow, [yearStart, dmaName, bpMonth, yearStart], {
      label: `Network pins (established) - ${dmaName}`,
    }),
  ]);

  const toPin = (row: z.infer<typeof NetworkPinRow>, isNew: boolean): NetworkPin => ({
    property_name: row.PROPERTY_NAME || "",
    lat: row.LAT,
    lon: row.LON,
    is_new_this_year: isNew,
  });

  return [
    ...newRows.map(r => toPin(r, true)),
    ...estRows.map(r => toPin(r, false)),
  ];
}

// ─── 6. Outlier filtering ───────────────────────────────────────────────────

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLam = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pinsCentroid(pins: Array<{ lat: number; lon: number }>): { lat: number; lon: number } | null {
  const valid = pins.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (valid.length === 0) return null;
  const lats = valid.map(p => p.lat).sort((a, b) => a - b);
  const lons = valid.map(p => p.lon).sort((a, b) => a - b);
  const med = (arr: number[]) => {
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  };
  return { lat: med(lats), lon: med(lons) };
}

export function filterPinsByDistance(
  pins: Array<{ lat: number; lon: number }>,
  anchorLat: number,
  anchorLon: number,
  maxMiles = 90
): typeof pins {
  return pins.filter(
    p => Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
      haversineMiles(p.lat, p.lon, anchorLat, anchorLon) <= maxMiles
  );
}

export function filterPinsNearAny<T extends { lat: number; lon: number }>(
  pins: T[],
  referencePins: Array<{ lat: number; lon: number }>,
  maxMiles = 35
): T[] {
  // Must check for VALID (finite) reference pins, not just a non-empty array. If every
  // referencePin has NaN coordinates (e.g. an upload where every address failed geocoding -
  // see assignMarkets' NaN sentinel for failed geocodes), referencePins.length is still > 0,
  // so the old `=== 0` check never caught this: haversineMiles against NaN always returns NaN,
  // and `NaN <= maxMiles` is always false, so EVERY network pin silently got filtered out even
  // though the pool of real matches (confirmed via pullMarketSummary) was healthy. Filter to
  // finite references first, then fall back to unfiltered pins if none survive - showing the
  // real Flex network for this market is strictly better than showing nothing just because we
  // don't know exactly where the prospect's own properties are.
  const validReferences = referencePins.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  if (validReferences.length === 0) return pins;
  return pins.filter(p =>
    Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    validReferences.some(r => haversineMiles(p.lat, p.lon, r.lat, r.lon) <= maxMiles)
  );
}

// ─── 7. Fetch with escalation ───────────────────────────────────────────────

export async function fetchRelevantNetworkPins(
  subMarkets: string[],
  bpMonth: string,
  yearStart: string,
  prospectPins: ProspectPin[],
  sfClient: SnowflakeClient,
  similarityByDma?: Record<string, SimilarityInfo | null>
): Promise<NetworkPin[]> {
  let filtered: NetworkPin[] = [];

  for (const fetchCap of NETWORK_PIN_FETCH_STEPS) {
    const allRaw: NetworkPin[] = [];
    for (const dma of subMarkets) {
      const sim = similarityByDma?.[dma] ?? null;
      const pins = await pullNetworkPins(dma, bpMonth, yearStart, fetchCap, 50, sfClient, sim);
      allRaw.push(...pins);
    }

    filtered = prospectPins.length > 0
      ? filterPinsNearAny(allRaw, prospectPins) as NetworkPin[]
      : allRaw;

    const exhausted = allRaw.length < fetchCap * subMarkets.length;
    if (filtered.length >= NETWORK_PIN_DISPLAY_CAP || exhausted) break;
  }

  return filtered.slice(0, NETWORK_PIN_DISPLAY_CAP);
}

// ─── 8. Market totals + annual guarantee ────────────────────────────────────

export function marketTotals(
  market: Market,
  summaryByDma: Record<string, MarketSummary>
): MarketSummary {
  const sum = (field: keyof MarketSummary) =>
    market.sub_markets.reduce((acc, dma) => acc + ((summaryByDma[dma] as any)?.[field] ?? 0), 0);

  const totalUnits = sum("total_units");
  const totalBillsPaid = market.sub_markets.reduce(
    (acc, dma) => acc + (summaryByDma[dma]?.total_units ?? 0) * (summaryByDma[dma]?.avg_adoption ?? 0),
    0
  );

  return {
    total_properties: sum("total_properties"),
    total_pmcs: sum("total_pmcs"),
    total_units: totalUnits,
    total_active_users: sum("total_active_users"),
    avg_adoption: totalUnits > 0 ? totalBillsPaid / totalUnits : 0,
    rent_paid_month: sum("rent_paid_month"),
    total_rent_paid_all_time: sum("total_rent_paid_all_time"),
    new_properties_this_year: sum("new_properties_this_year"),
    new_pmcs_this_year: sum("new_pmcs_this_year"),
    new_properties_rent_paid: sum("new_properties_rent_paid"),
  };
}

export function marketAnnualGuarantee(
  totals: MarketSummary,
  prospectUnits: number,
  avgRentInput: number | null
): MarketGuarantee {
  const totalActiveUsers = totals.total_active_users;
  const rentPaidMonth = totals.rent_paid_month;
  const avgRentIsMarketFallback = !avgRentInput;
  const avgRent = avgRentInput
    ? avgRentInput
    : totalActiveUsers > 0 ? rentPaidMonth / totalActiveUsers : 0;
  const showGuarantee = prospectUnits > 0 && avgRent > 0;
  const annualGuarantee = showGuarantee
    ? prospectUnits * avgRent * totals.avg_adoption * 12
    : 0;

  return {
    annual_guarantee: annualGuarantee,
    avg_rent: avgRent,
    avg_rent_is_market_fallback: avgRentIsMarketFallback,
    show_guarantee: showGuarantee,
  };
}

// ─── 9. Derive states from geocoded properties (with 5% threshold) ──────────

export interface StateSummary {
  /** States that meet the min_share threshold */
  included: string[];
  /** States excluded (below threshold) — with their share and unit count */
  excluded: Array<{ state: string; share: number; units: number; property_count: number }>;
  /** "units" if any property has units>0, else "properties" */
  basis: "units" | "properties";
  /** The min_share threshold used */
  min_share: number;
  /** True only when at least one state was excluded in the FINAL result */
  pruned: boolean;
}

/**
 * Port of Python's summarize_states_from_properties (generator/prospect.py:2619).
 * Applies a min-share threshold (default 5%) so a single low-exposure state
 * doesn't count as part of the prospect's footprint for peer matching.
 *
 * Falls back to property-count share when all units are 0.
 * Prune-tail-only: if filtering would exclude EVERY state, returns the full set.
 */
export function summarizeStatesFromProperties(
  properties: Array<{ state?: string; units?: number }>,
  minShare = 0.05
): StateSummary {
  const withState = properties.filter(p => p.state && p.state.length === 2);

  const unitsByState: Record<string, number> = {};
  const countByState: Record<string, number> = {};
  for (const p of withState) {
    const st = p.state!.toUpperCase();
    unitsByState[st] = (unitsByState[st] || 0) + (p.units || 0);
    countByState[st] = (countByState[st] || 0) + 1;
  }

  const totalUnits = Object.values(unitsByState).reduce((a, b) => a + b, 0);
  let basis: "units" | "properties";
  let weightByState: Record<string, number>;

  if (totalUnits > 0) {
    basis = "units";
    weightByState = unitsByState;
  } else {
    basis = "properties";
    weightByState = Object.fromEntries(
      Object.entries(countByState).map(([st, c]) => [st, c])
    );
  }

  const totalWeight = Object.values(weightByState).reduce((a, b) => a + b, 0);
  const shares: Record<string, number> = {};
  for (const [st, w] of Object.entries(weightByState)) {
    shares[st] = totalWeight > 0 ? w / totalWeight : 0;
  }

  const allStates = Object.keys(weightByState).sort();
  let included = allStates.filter(st => shares[st] >= minShare);
  let excluded = allStates
    .filter(st => shares[st] < minShare)
    .map(st => ({
      state: st,
      share: shares[st],
      units: unitsByState[st] || 0,
      property_count: countByState[st] || 0,
    }));

  // Prune-tail-only: if filtering would exclude EVERY state, return full set
  if (included.length === 0 && allStates.length > 0) {
    included = allStates;
    excluded = [];
  }

  return {
    included,
    excluded,
    basis,
    min_share: minShare,
    pruned: excluded.length > 0,
  };
}

/**
 * Simple version for backward compat — returns just the included states array.
 * This is the drop-in replacement for the old deriveStatesFromProperties.
 */
export function deriveStatesFromProperties(
  properties: Array<{ state?: string; units?: number }>
): string[] {
  return summarizeStatesFromProperties(properties).included;
}

// ─── 10. Apply outlier filter to prospect pins ──────────────────────────────

export function filterProspectPinsForMarket(
  prospectPins: ProspectPin[],
  networkPinSample: NetworkPin[]
): ProspectPin[] {
  // Anchor = median of COMBINED prospect + network pins
  const combined = [...prospectPins, ...networkPinSample];
  const anchor = pinsCentroid(combined);
  if (!anchor) return prospectPins;

  return filterPinsByDistance(prospectPins, anchor.lat, anchor.lon, 90) as ProspectPin[];
}
