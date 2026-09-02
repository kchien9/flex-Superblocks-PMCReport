/**
 * Market Map slide renderer.
 * Produces one HTML slide with a Leaflet map + stats panel per qualifying market.
 */

import type { SlideResult } from "./slide-renderers.js";
import type {
  Market,
  MarketSummary,
  NetworkPin,
  ProspectPin,
  MarketGuarantee,
  MatchedUsageTotals,
} from "./market-map-data.js";
import { marketTotals, marketAnnualGuarantee } from "./market-map-data.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert "LOS ANGELES" → "Los Angeles", preserving short words like "of", "the" in lowercase. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtAbbrev(v: number, decimals = 0): string {
  const trim = (s: string) => {
    if (decimals > 0 && s.includes(".")) return s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  };
  if (v >= 1_000_000_000) return `$${trim((v / 1_000_000_000).toFixed(decimals))}B`;
  if (v >= 1_000_000) return `$${trim((v / 1_000_000).toFixed(decimals))}M`;
  if (v >= 1_000) {
    const scaled = (v / 1_000).toFixed(decimals);
    if (parseFloat(scaled) >= 1_000) return `$${trim((v / 1_000_000).toFixed(1))}M`;
    return `$${trim(scaled)}K`;
  }
  return `$${trim(v.toFixed(decimals))}`;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const NETWORK_PURPLE = "#6A3DB8";
const NEW_HIGHLIGHT = "#DDC6F9";
const PROSPECT_GREEN = "#1a9e6a";
/** Gold ring drawn inside a prospect pin already matched to real in-network Flex usage. */
const USAGE_HIGHLIGHT_RING = "#F5B841";
/** Teal ring for OON self-serve usage (Flex Anywhere/Embed/P2P) - deliberately a different
 * color from the gold in-network ring so the two stories don't visually blur together. */
const OON_USAGE_HIGHLIGHT_RING = "#2E9CA6";

function pinIconSvg(color: string): string {
  return (
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;margin-top:2px;">` +
    `<path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 6.72 11.34 7.39 11.94a.9.9 0 0 0 1.22 0` +
    `C13.28 21.34 20 15.25 20 10c0-4.42-3.58-8-8-8z" fill="${color}"/>` +
    `<circle cx="12" cy="10" r="3.2" fill="#FFFFFF"/></svg>`
  );
}

function bullet(label: string, value: string, sub = "", color = NETWORK_PURPLE): string {
  const subHtml = sub
    ? `<div style="font-size:13px;color:#6b7280;margin-top:4px;">${sub}</div>`
    : "";
  return `
    <div style="display:flex;align-items:flex-start;gap:14px;padding:18px 0;border-bottom:1px solid #ede9fe;">
      ${pinIconSvg(color)}
      <div>
        <div style="font-size:16px;color:#1D1D1D;">${label}: <strong style="color:${color};">${value}</strong></div>
        ${subHtml}
      </div>
    </div>`;
}

// ─── Public ─────────────────────────────────────────────────────────────────

export function renderMarketMap(
  slideId: number,
  market: Market,
  summaryByDma: Record<string, MarketSummary>,
  prospectPins: ProspectPin[],
  networkPins: NetworkPin[],
  prospectUnits: number,
  avgRentInput: number | null,
  usage: MatchedUsageTotals,
  oonUsage: MatchedUsageTotals
): SlideResult {
  const totals = marketTotals(market, summaryByDma);
  const {
    total_properties,
    total_pmcs,
    total_active_users,
    avg_adoption,
    rent_paid_month,
    total_rent_paid_all_time,
    new_properties_this_year,
    new_pmcs_this_year,
    new_properties_rent_paid,
  } = totals;

  // Similarity label for the property-count bullet — the `similarity` object (tier, label,
  // is_fallback, pool sizes) was already computed by pullMarketSummary per DMA, but nothing on
  // this slide ever surfaced it: the viewer had no way to tell "this count is rent-matched" from
  // "this is market-wide," which is exactly the distinction the whole feature exists to show.
  // A market grouping can span multiple sub_markets (DMAs), each independently resolving its own
  // tier, so pick the WORST (most-fallback) tier across them for an honest single label rather
  // than reporting the best one and implying uniform filtering that didn't actually happen
  // everywhere.
  const subDmaSimilarities = market.sub_markets
    .map((dma) => summaryByDma[dma]?.similarity)
    .filter((s): s is NonNullable<typeof s> => s != null);
  const TIER_RANK: Record<string, number> = { "rent+size": 0, "rent": 1, "all": 2 };
  const worstSimilarity = subDmaSimilarities.length > 0
    ? subDmaSimilarities.reduce((worst, s) => (TIER_RANK[s.tier] > TIER_RANK[worst.tier] ? s : worst))
    : null;
  const similaritySubtext = worstSimilarity
    ? `across ${total_pmcs.toLocaleString()} property management companies — ${worstSimilarity.label}`
    : `across ${total_pmcs.toLocaleString()} property management companies`;

  // Build stats bullets
  let bulletsHtml =
    bullet(
      "Properties on Flex in this market",
      `${total_properties.toLocaleString()}`,
      similaritySubtext
    ) +
    bullet("Active residents splitting rent", `${total_active_users.toLocaleString()}`) +
    bullet("Average adoption rate", `${(avg_adoption * 100).toFixed(1)}%`) +
    bullet(
      "Rent guaranteed through Flex",
      `${fmtAbbrev(rent_paid_month, 1)}/mo`,
      `${fmtAbbrev(total_rent_paid_all_time, 1)} paid out all-time`
    ) +
    bullet(
      "New to Flex this year",
      `${new_properties_this_year.toLocaleString()} properties`,
      `across ${new_pmcs_this_year.toLocaleString()} PMCs — already generating ${fmtAbbrev(new_properties_rent_paid, 1)} in guaranteed rent`,
      NEW_HIGHLIGHT
    );

  // Green guarantee bullet
  const guarantee: MarketGuarantee = marketAnnualGuarantee(totals, prospectUnits, avgRentInput);
  let guaranteeFootnoteHtml = "";
  if (guarantee.show_guarantee) {
    // "Your Los Angeles properties" (not "Your portfolio") - this number is scoped to just
    // this one market, not the prospect's whole company. The cover slide's own guarantee
    // figure is portfolio-wide and uses a completely different peer-matching basis (comparable
    // PMCs, not comparable properties in one market) - the two numbers are NOT meant to
    // reconcile to each other, but "portfolio" here implied whole-company scope when it's
    // really just this market, which read as a contradiction rather than two intentional
    // lenses. See the footnote below for the explicit callout.
    bulletsHtml += bullet(
      `Your ${escapeHtml(titleCase(market.label))} properties could be guaranteeing`,
      `${fmtAbbrev(guarantee.annual_guarantee, 1)}/yr`,
      "",
      PROSPECT_GREEN
    );
    // "properties like yours in this market," not "this market's average rent" - totals
    // (marketTotals) is built from pullMarketSummary's already rent+size-similarity-filtered
    // chosenRow, not the unfiltered market_wide numbers, so this fallback rent already reflects
    // the comparable peer set, not every property in the market regardless of size/rent fit.
    const rentSource = guarantee.avg_rent_is_market_fallback
      ? "avg rent of properties like yours in this market"
      : "your average rent input";
    guaranteeFootnoteHtml = `
      <div style="font-size:11px;color:#a09cb0;margin-top:14px;line-height:1.5;">
        Estimated guarantee: your ${prospectUnits.toLocaleString()} units &times; $${guarantee.avg_rent.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
        (${rentSource}) &times; ${(avg_adoption * 100).toFixed(1)}% market adoption rate, annualized.
        Actual results will vary.
      </div>
      <div style="font-size:11px;color:#a09cb0;margin-top:8px;line-height:1.5;">
        This reflects your properties in ${escapeHtml(titleCase(market.label))} only, benchmarked against comparable properties in this specific market &mdash;
        a different, narrower lens than the portfolio-wide comparison against similar PMCs shown earlier in this deck. Both are real estimates; they're not meant to add up to the same number.
      </div>`;
  }

  // "Already seeing usage" callout (Kevin's ask) - only when matchProspectUsage found at least
  // one confident match; never shows a "0 properties" line. Ties visually to the gold-ringed
  // pins on the map via the same PROSPECT_GREEN color and an explicit callout to "highlighted".
  if (usage.matched_count > 0) {
    bulletsHtml += bullet(
      "Already seeing usage on Flex",
      `${usage.residents.toLocaleString()} resident${usage.residents === 1 ? "" : "s"} paying`,
      `${fmtAbbrev(usage.ytd_rent, 1)} YTD at ${usage.matched_count.toLocaleString()} of your propert${usage.matched_count === 1 ? "y" : "ies"} in this market &mdash; highlighted in gold on the map`,
      PROSPECT_GREEN
    );
  }

  // OON self-serve usage callout (Kevin's framing): residents already found Flex on their own,
  // with zero integration - which means zero visibility or control for the PMC today. Worded
  // to make that gap the point, since it's the actual case for a real integration, not just a
  // stat. Kept as its own bullet/color, never merged into the in-network one above.
  if (oonUsage.matched_count > 0) {
    bulletsHtml += bullet(
      "Residents already found Flex on their own",
      `${oonUsage.residents.toLocaleString()} resident${oonUsage.residents === 1 ? "" : "s"} paying`,
      `${fmtAbbrev(oonUsage.ytd_rent, 1)} YTD at ${oonUsage.matched_count.toLocaleString()} of your propert${oonUsage.matched_count === 1 ? "y" : "ies"} &mdash; with no integration today, you have zero visibility or control over this. A real integration changes that.`,
      OON_USAGE_HIGHLIGHT_RING
    );
  }

  // Header
  const headerHtml = `
    <div style="font-size:14px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${NETWORK_PURPLE};margin-bottom:10px;">FLEX IS ALREADY IN YOUR MARKET</div>
    <div style="font-size:32px;font-weight:700;color:#1D1D1D;margin-bottom:14px;">${escapeHtml(market.label)}</div>
    <div style="border-top:2px solid ${NETWORK_PURPLE};margin-bottom:8px;"></div>`;

  // "Not pictured" note
  const pinsNotPictured = Math.max(0, total_properties - networkPins.length);
  const notPicturedHtml = pinsNotPictured > 0
    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(0,0,0,0.08);color:#6b7280;">
        Showing ${networkPins.length.toLocaleString()} of ${total_properties.toLocaleString()} properties &mdash;
        <strong style="color:#1D1D1D;">${pinsNotPictured.toLocaleString()} more</strong> not pictured
      </div>`
    : "";

  // Legend
  const prospectLabel = prospectPins.length === 1 ? "Your 1 property" : `Your ${prospectPins.length.toLocaleString()} properties`;

  const html = `
  <style>
    .market-map-pin-label {
      background: #FFFFFF; border: 1px solid ${NETWORK_PURPLE}; border-radius: 4px;
      font-family: inherit; font-size: 10px; font-weight: 600; color: #1D1D1D;
      padding: 2px 6px; box-shadow: none;
    }
    .market-map-pin-label::before { display: none; }
  </style>
  <div class="slide" id="slide-${slideId}" style="background:#FFFFFF;flex-direction:row;padding:0;position:relative;">
    <div style="flex:1.2;position:relative;">
      <div id="map-${slideId}" style="position:absolute;inset:0;"></div>
      <div style="position:absolute;bottom:16px;left:16px;z-index:1000;background:rgba(255,255,255,0.92);border-radius:8px;padding:10px 14px;font-size:11px;color:#1D1D1D;box-shadow:0 2px 8px rgba(0,0,0,0.12);">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;"><span style="width:9px;height:9px;border-radius:50%;background:${PROSPECT_GREEN};display:inline-block;"></span>${prospectLabel}</div>
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;"><span style="width:9px;height:9px;border-radius:50%;background:${NETWORK_PURPLE};display:inline-block;"></span>Flex network</div>
        <div style="display:flex;align-items:center;gap:7px;${(usage.matched_count > 0 || oonUsage.matched_count > 0) ? "margin-bottom:5px;" : ""}"><span style="width:9px;height:9px;border-radius:50%;background:${NEW_HIGHLIGHT};display:inline-block;"></span>New to Flex this year</div>
        ${usage.matched_count > 0 ? `<div style="display:flex;align-items:center;gap:7px;${oonUsage.matched_count > 0 ? "margin-bottom:5px;" : ""}"><span style="width:9px;height:9px;border-radius:50%;background:${PROSPECT_GREEN};border:2px solid ${USAGE_HIGHLIGHT_RING};display:inline-block;"></span>Already has Flex usage</div>` : ""}
        ${oonUsage.matched_count > 0 ? `<div style="display:flex;align-items:center;gap:7px;"><span style="width:9px;height:9px;border-radius:50%;background:${PROSPECT_GREEN};border:2px solid ${OON_USAGE_HIGHLIGHT_RING};display:inline-block;"></span>Residents using Flex on their own</div>` : ""}
        ${notPicturedHtml}
      </div>
    </div>
    <div style="flex:1;padding:32px 28px;overflow-y:auto;border-left:2px solid #1D1D1D;">
      ${headerHtml}
      ${bulletsHtml}
      ${guaranteeFootnoteHtml}
    </div>
  </div>`;

  // Serialize pin data for JS
  const networkPinsJson = JSON.stringify(
    networkPins.map(p => ({ lat: p.lat, lon: p.lon, is_new_this_year: p.is_new_this_year }))
  );
  const prospectPinsJson = JSON.stringify(
    prospectPins.map(p => ({
      lat: p.lat, lon: p.lon, property_name: p.property_name,
      has_usage: !!p.has_usage, has_oon_usage: !!p.has_oon_usage,
    }))
  );

  const js = `<script>
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return;
    if (typeof L === 'undefined') return;
    done = true;
    const map = L.map('map-${slideId}', {center: [39.8, -98.6], zoom: 4});
    // Switched from CARTO's Voyager raster tiles (Kevin's catch - "why is the map showing
    // 'API KEY REQUIRED'"). CARTO locked basemaps.cartocdn.com behind a mandatory API key at
    // some point; that watermark text is literally CARTO's own tile response when unauthenticated,
    // burned into the image itself - confirmed by inspecting this exact tile URL directly, not
    // guessed from "maybe it's an old export." Esri's Light Gray Canvas is the free, no-key,
    // no-signup replacement most commonly used as a CartoDB Positron/Voyager substitute - two
    // stacked layers (base + reference for roads/labels), same as Esri's own documented pattern.
    // No account, no quota to watch, no risk of this specific failure mode recurring.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 16
    }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 16
    }).addTo(map);
    function isFinitePin(p) { return Number.isFinite(p.lat) && Number.isFinite(p.lon); }
    const networkPins = (${networkPinsJson}).filter(isFinitePin);
    const prospectPins = (${prospectPinsJson}).filter(isFinitePin);
    const bounds = [];
    function pinIcon(color, size, ringColor) {
      const w = size || 26, h = w * 32 / 24;
      // Ring drawn INSIDE the pin head (not an outline of the full teardrop) - the teardrop
      // path already touches the viewBox edges at its widest point, so a stroke traced on
      // that same path would clip. A ring around the existing white center dot stays
      // comfortably inside the colored head at every icon size used here.
      var ring = ringColor ? '<circle cx="12" cy="12" r="6.5" fill="none" stroke="' + ringColor + '" stroke-width="2.2"/>' : '';
      return L.divIcon({
        className: '',
        html: '<svg width="' + w + '" height="' + h + '" viewBox="0 0 24 32" fill="none">'
          + '<path d="M12 0C5.37 0 0 5.37 0 12c0 8.5 10.5 18.5 11.3 19.3a1 1 0 0 0 1.4 0'
          + 'C13.5 30.5 24 20.5 24 12 24 5.37 18.63 0 12 0z" fill="' + color + '"/>'
          + ring
          + '<circle cx="12" cy="12" r="4.2" fill="#FFFFFF"/></svg>',
        iconSize: [w, h], iconAnchor: [w / 2, h],
      });
    }
    networkPins.forEach(function(p) {
      var pinColor = p.is_new_this_year ? '${NEW_HIGHLIGHT}' : '${NETWORK_PURPLE}';
      L.marker([p.lat, p.lon], {icon: pinIcon(pinColor)}).addTo(map);
      bounds.push([p.lat, p.lon]);
    });
    prospectPins.forEach(function(p) {
      var ringColor = p.has_usage ? '${USAGE_HIGHLIGHT_RING}' : (p.has_oon_usage ? '${OON_USAGE_HIGHLIGHT_RING}' : null);
      var marker = L.marker([p.lat, p.lon], {icon: pinIcon('${PROSPECT_GREEN}', undefined, ringColor), zIndexOffset: 1000}).addTo(map);
      if (p.property_name) {
        marker.bindTooltip(p.property_name, {permanent: true, direction: 'right', offset: [10, -14], className: 'market-map-pin-label'});
      }
      bounds.push([p.lat, p.lon]);
    });
    setTimeout(function() {
      map.invalidateSize();
      try {
        if (bounds.length) {
          // Wrap in L.latLngBounds first — calling .pad() on a plain array crashes.
          // The same object is reused for both fitBounds and setMaxBounds.
          var fittedBounds = L.latLngBounds(bounds);
          map.fitBounds(fittedBounds, {padding: [20, 20], animate: false});
          map.setMinZoom(map.getZoom());
          // Constrain panning to prevent the map from scrolling into empty space.
          // pad(0.3) adds 30% breathing room so the user can still drag a little.
          map.setMaxBounds(fittedBounds.pad(0.3));
        } else {
          map.setMinZoom(4);
        }
      } catch (e) {
        console.error('slide ${slideId} fitBounds failed:', e);
        map.setMinZoom(4);
      }
    }, 0);
  };
})();
</script>`;

  return { html, js };
}
