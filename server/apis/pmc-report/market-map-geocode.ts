/**
 * Geocoding utility for Market Map feature.
 * Census Bureau (primary, concurrent) + Nominatim (fallback, sequential 1/sec).
 * No API keys required for either service.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const CENSUS_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "FlexRevenueOS/1.0 (market-map-geocoder)";

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
  nominatim_hits: number;
  errors: string[]; // first few error messages
}

// ─── State name → 2-letter code lookup (for Nominatim) ─────────────────────

const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
};

// ─── Internal helpers ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Collects error messages during a geocoding batch; reset per call
let _errorCollector: string[] = [];

async function geocodeViaCensus(address: string): Promise<GeoResult | null> {
  try {
    const queryString = `address=${encodeURIComponent(address)}&benchmark=${encodeURIComponent(CENSUS_BENCHMARK)}&format=json`;
    const fullUrl = `${CENSUS_URL}?${queryString}`;

    const resp = await fetch(fullUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const msg = `Census HTTP ${resp.status} for: ${address.slice(0, 60)}`;
      console.warn(`[GEOCODE-DIAG] ${msg}`);
      if (_errorCollector.length < 5) _errorCollector.push(msg);
      return null;
    }

    const data = await resp.json();
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

async function geocodeViaNominatim(address: string): Promise<GeoResult | null> {
  try {
    const queryString = `q=${encodeURIComponent(address)}&format=jsonv2&addressdetails=1&limit=1`;
    const fullUrl = `${NOMINATIM_URL}?${queryString}`;

    const resp = await fetch(fullUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    // Always sleep 1s after Nominatim call (usage policy: max 1 req/sec)
    await sleep(1000);

    if (!resp.ok) return null;

    const results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const top = results[0];
    const rawState = top?.address?.state ?? "";
    const stateCode = rawState
      ? (STATE_NAME_TO_CODE[rawState] ?? rawState).toUpperCase().slice(0, 2)
      : "";

    return {
      lat: Number(top.lat),
      lon: Number(top.lon),
      zip: String(top?.address?.postcode ?? "").slice(0, 5),
      state: stateCode,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[GEOCODE-DIAG] Nominatim EXCEPTION for "${address}": ${msg}`);
    if (_errorCollector.length < 5) _errorCollector.push(`Nominatim: ${msg}`);
    await sleep(1000);
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
 *  2. Census lookups concurrently (up to 10 parallel)
 *  3. Nominatim fallback sequentially (1 req/sec) for Census misses
 *
 * Returns a map of address → GeoResult | null (one entry per unique input).
 */
export async function geocodeAddressesConcurrent(
  addresses: string[]
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

  // Phase 1: Census (concurrent)
  const censusResults = await mapWithConcurrency(
    unique,
    CENSUS_CONCURRENCY,
    geocodeViaCensus
  );

  let censusHits = 0;
  const nominatimQueue: string[] = [];
  for (let i = 0; i < unique.length; i++) {
    if (censusResults[i] != null) {
      results[unique[i]] = censusResults[i];
      censusHits++;
    } else {
      nominatimQueue.push(unique[i]);
    }
  }

  // Phase 2: Nominatim fallback (sequential, 1/sec)
  let nominatimHits = 0;
  for (const addr of nominatimQueue) {
    const geo = await geocodeViaNominatim(addr);
    results[addr] = geo;
    if (geo != null) {
      nominatimHits++;
    }
  }

  // Build diagnostic
  const successCount = censusHits + nominatimHits;
  const failedCount = unique.length - successCount;

  // Include both fetch-level errors and addresses that returned no result
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
      nominatim_hits: nominatimHits,
      errors: diagErrors,
    },
  };
}
