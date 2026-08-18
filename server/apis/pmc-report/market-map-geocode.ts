/**
 * Geocoding utility for Market Map feature.
 * Census Bureau, via the Superblocks "Census Geocoder" REST API integration
 * (integration ID 3d0e85c7-61d4-402f-bf97-64a3428c15a4, base URL
 * https://geocoding.geo.census.gov — confirm in Superblocks' Integrations panel if the
 * path below 404s). No API key required.
 *
 * CORRECTION: this used to call the browser/Node `fetch()` API directly, with a second
 * Nominatim (OpenStreetMap) fallback tier for addresses Census couldn't resolve. Confirmed
 * live: every single geocode call failed with "ReferenceError: fetch is not defined" -
 * Superblocks' server-side execution sandbox doesn't expose a global fetch (consistent with
 * every OTHER external call in this entire codebase going through ctx.integrations.X -
 * Snowflake, Salesforce, Notion, Anthropic - never raw fetch/http; this geocoder was the one
 * exception, and the one place failing). Rewired to use the REST API integration client
 * instead. Nominatim dropped entirely (Kevin's call) rather than standing up a second
 * integration for it - Census alone covers the large majority of standard US addresses, and
 * an address it can't resolve simply doesn't get a map pin rather than erroring.
 */

import { z } from "@superblocksteam/sdk-api";

// ─── Constants ──────────────────────────────────────────────────────────────

const CENSUS_PATH = "/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";
const CENSUS_CONCURRENCY = 10;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GeoResult {
  lat: number;
  lon: number;
  zip: string;
  state: string; // 2-letter code
}

export interface GeocodeDiagnostic {
  total: number;
  success: number;
  failed: number;
  census_hits: number;
  nominatim_hits: number; // always 0 now - kept so the output schema/client don't need to change
  errors: string[]; // first few error messages
}

/** Minimal shape this file actually needs from the REST API integration client - avoids
 * importing the full SDK type, matching the same lightweight-local-interface pattern
 * market-map-data.ts already uses for its own SnowflakeClient. */
export interface CensusGeocoderClient {
  apiRequest<T>(
    request: { method: string; path: string; params?: Record<string, unknown> },
    schema: { response: z.ZodType<T> },
    metadata?: { label?: string }
  ): Promise<T>;
}

// ─── Response schema ────────────────────────────────────────────────────────

// Loosely typed on purpose (passthrough + optional almost everywhere) - Census's own response
// shape isn't formally documented/versioned, and the original fetch-based code handled it with
// plain optional chaining rather than a strict schema. Coercing coordinates to number since the
// original code explicitly wrapped them in Number(...), implying they don't reliably come back
// as JSON numbers.
const CensusResponseSchema = z
  .object({
    result: z
      .object({
        addressMatches: z
          .array(
            z
              .object({
                coordinates: z
                  .object({
                    x: z.coerce.number().nullable().optional(),
                    y: z.coerce.number().nullable().optional(),
                  })
                  .passthrough()
                  .optional(),
                addressComponents: z
                  .object({
                    zip: z.coerce.string().optional(),
                    state: z.coerce.string().optional(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough()
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ─── Internal helpers ───────────────────────────────────────────────────────

// Collects error messages during a geocoding batch; reset per call
let _errorCollector: string[] = [];

async function geocodeViaCensus(
  address: string,
  client: CensusGeocoderClient
): Promise<GeoResult | null> {
  try {
    const data = await client.apiRequest(
      {
        method: "GET",
        path: CENSUS_PATH,
        params: { address, benchmark: CENSUS_BENCHMARK, format: "json" },
      },
      { response: CensusResponseSchema },
      { label: `Census geocode: ${address.slice(0, 60)}` }
    );

    const matches = data?.result?.addressMatches;
    if (!matches || matches.length === 0) return null;

    const top = matches[0];
    const coords = top?.coordinates;
    const components = top?.addressComponents ?? {};

    if (coords?.x == null || coords?.y == null) return null;

    return {
      lat: Number(coords.y),
      lon: Number(coords.x),
      zip: String(components.zip ?? ""),
      state: String(components.state ?? "").toUpperCase().slice(0, 2),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[GEOCODE-DIAG] Census EXCEPTION for "${address}": ${msg}`);
    if (_errorCollector.length < 5) _errorCollector.push(`Census: ${msg}`);
    return null;
  }
}

// ─── Concurrency helper ─────────────────────────────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Geocode a batch of addresses efficiently:
 *  1. Deduplicate input addresses
 *  2. Census lookups concurrently (up to 10 parallel), via the Superblocks REST integration
 *
 * Returns a map of address → GeoResult | null (one entry per unique input).
 */
export async function geocodeAddressesConcurrent(
  addresses: string[],
  censusClient: CensusGeocoderClient
): Promise<{ results: Record<string, GeoResult | null>; diagnostic: GeocodeDiagnostic }> {
  _errorCollector = []; // reset per batch
  const results: Record<string, GeoResult | null> = {};
  const unique: string[] = [];

  // Deduplicate
  const seen = new Set<string>();
  for (const addr of addresses) {
    const key = addr.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }

  if (unique.length === 0) {
    return {
      results,
      diagnostic: { total: 0, success: 0, failed: 0, census_hits: 0, nominatim_hits: 0, errors: [] },
    };
  }

  const censusResults = await mapWithConcurrency(
    unique,
    CENSUS_CONCURRENCY,
    (addr) => geocodeViaCensus(addr, censusClient)
  );

  let censusHits = 0;
  for (let i = 0; i < unique.length; i++) {
    results[unique[i]] = censusResults[i];
    if (censusResults[i] != null) censusHits++;
  }

  const successCount = censusHits;
  const failedCount = unique.length - successCount;

  // Include both request-level errors and addresses that returned no result
  const diagErrors = [..._errorCollector];
  for (const addr of unique) {
    if (results[addr] == null && diagErrors.length < 8) {
      diagErrors.push(`No coords: "${addr.slice(0, 80)}"`);
    }
  }

  return {
    results,
    diagnostic: {
      total: unique.length,
      success: successCount,
      failed: failedCount,
      census_hits: censusHits,
      nominatim_hits: 0,
      errors: diagErrors,
    },
  };
}
