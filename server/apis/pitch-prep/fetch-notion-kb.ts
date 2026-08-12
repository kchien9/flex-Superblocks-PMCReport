import { api, z, notion } from "@superblocksteam/sdk-api";

const NOTION_REVENUE = "3525df5f-aaee-422b-97c2-b3ac766505d9";

const KB_PAGES = [
  { id: "2bc4b351-646a-8029-b374-c0de0b881b4d", name: "PMC Value | MetroSight Research Study Findings GTM" },
  { id: "2e14b351-646a-8081-91a1-ce7b16df5544", name: "PMC Value Proof Points" },
  { id: "2fc4b351-646a-80f0-8eb2-d5d1ff32da49", name: "Flex B2B | Jobs to Be Done" },
  { id: "3274b351-646a-81ec-b293-ca40112e449f", name: "Segmentation & Personas" },
  { id: "2fe4b351-646a-800b-90d3-c5fed4f6dbd6", name: "PMC Personas" },
  { id: "2764b351-646a-80ce-9b7d-ccbdd00033f2", name: "Sales Process 2.0" },
  { id: "9ac75b51-e59d-4957-b9b7-11908db2fff1", name: "Product Research" },
];

// Loose schema for Notion block children response
const BlockChildrenResponseSchema = z.object({
  results: z.array(z.record(z.unknown())),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export default api({
  name: "FetchNotionKB",
  description: "Fetches 7 Notion KB pages in parallel and returns combined plain text",

  integrations: {
    wiki: notion(NOTION_REVENUE),
  },

  input: z.object({}),

  output: z.object({
    content: z.string(),
    pagesFetched: z.number(),
  }),

  async run(ctx) {
    ctx.log.info("Fetching Notion knowledge base pages", { pageCount: KB_PAGES.length });

    // Helper: extract plain text from rich_text array
    function extractText(richText: unknown): string {
      if (!Array.isArray(richText)) return "";
      return richText
        .map((rt: any) => rt?.plain_text ?? "")
        .join("");
    }

    // Helper: convert a single block to a text line
    function blockToText(block: any, indent: string = ""): string {
      const type = block?.type;
      if (!type) return "";

      const data = block[type];
      if (!data) return "";

      switch (type) {
        case "paragraph":
        case "quote":
        case "callout":
          return indent + extractText(data.rich_text);

        case "heading_1":
          return indent + "# " + extractText(data.rich_text);

        case "heading_2":
          return indent + "## " + extractText(data.rich_text);

        case "heading_3":
          return indent + "### " + extractText(data.rich_text);

        case "bulleted_list_item":
        case "numbered_list_item":
          return indent + "- " + extractText(data.rich_text);

        case "toggle":
          return indent + extractText(data.rich_text);

        case "to_do":
          const checked = data.checked ? "[x]" : "[ ]";
          return indent + `${checked} ` + extractText(data.rich_text);

        case "table_row":
          if (Array.isArray(data.cells)) {
            return indent + data.cells.map((cell: any) => extractText(cell)).join(" | ");
          }
          return "";

        case "code":
          return indent + "```\n" + extractText(data.rich_text) + "\n```";

        case "divider":
          return indent + "---";

        default:
          // Try to get rich_text from unknown block types
          if (data.rich_text) {
            return indent + extractText(data.rich_text);
          }
          return "";
      }
    }

    // Helper: fetch all blocks for a page (handles pagination)
    async function fetchBlocks(blockId: string): Promise<any[]> {
      const allBlocks: any[] = [];
      let cursor: string | undefined;

      do {
        const params: Record<string, unknown> = { page_size: "100" };
        if (cursor) params.start_cursor = cursor;

        const resp = await ctx.integrations.wiki.apiRequest(
          {
            method: "GET",
            path: `/v1/blocks/${blockId}/children`,
            params,
            headers: { "Notion-Version": "2022-06-28" },
          },
          { response: BlockChildrenResponseSchema },
          { label: `Fetch blocks for ${blockId.slice(0, 8)}` }
        );

        allBlocks.push(...resp.results);
        cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
      } while (cursor);

      return allBlocks;
    }

    // Helper: convert blocks to text, recursively fetching children
    async function blocksToText(blocks: any[], indent: string = ""): Promise<string> {
      const lines: string[] = [];

      for (const block of blocks) {
        const line = blockToText(block, indent);
        if (line) lines.push(line);

        // Recursively fetch children if they exist
        if (block.has_children) {
          try {
            const children = await fetchBlocks(block.id);
            const childText = await blocksToText(children, indent + "  ");
            if (childText) lines.push(childText);
          } catch {
            // Skip children that fail to fetch
          }
        }
      }

      return lines.join("\n");
    }

    // Fetch all pages in parallel
    const results = await Promise.allSettled(
      KB_PAGES.map(async (page) => {
        const blocks = await fetchBlocks(page.id);
        const text = await blocksToText(blocks);
        return { name: page.name, text };
      })
    );

    // Combine successful results
    const sections: string[] = [];
    let pagesFetched = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.text) {
        sections.push(`## ${result.value.name}\n\n${result.value.text}`);
        pagesFetched++;
      }
    }

    const content = sections.join("\n\n---\n\n");
    ctx.log.info("Notion KB fetch complete", { pagesFetched, contentLength: content.length });

    return { content, pagesFetched };
  },
});
