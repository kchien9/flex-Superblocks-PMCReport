const DOC_EXPORT =
  "https://docs.google.com/document/d/1ge3-KExIGZFmwMZ8XFO9NlaiL4Kov_ZxmUVZZ0WP9Sw/export?format=txt";
const SLIDES_EXPORT =
  "https://docs.google.com/presentation/d/1-aInBxdrUH7iSaoHaxE38rrx2SQ10Vq3-eITXVz7Bp4/export/txt";

/**
 * Fetches the Flex Objection Handling Guide and Sales Deck from public
 * Google Docs/Slides export URLs. Returns combined markdown-style text.
 * Returns empty string if both fetches fail (403, network error, etc.).
 */
export async function fetchGoogleKB(): Promise<string> {
  let docText = "";
  let slidesText = "";

  try {
    const docResp = await fetch(DOC_EXPORT);
    if (docResp.ok) {
      docText = await docResp.text();
    }
  } catch {
    // Doc not publicly accessible — docText stays empty
  }

  try {
    const slidesResp = await fetch(SLIDES_EXPORT);
    if (slidesResp.ok) {
      slidesText = await slidesResp.text();
    }
  } catch {
    // Slides not publicly accessible — slidesText stays empty
  }

  const sections: string[] = [];
  if (docText) sections.push("## Flex Rent Objection Handling Guide\n\n" + docText);
  if (slidesText) sections.push("## Flex Sales Deck (Brad Sales Deck — April 2026)\n\n" + slidesText);
  return sections.join("\n\n---\n\n");
}
