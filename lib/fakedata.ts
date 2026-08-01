import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const MODEL = anthropic("claude-sonnet-5"); // direct Anthropic API (ANTHROPIC_API_KEY)

const FakeDataSchema = z.object({
  users: z
    .array(
      z.object({
        username: z.string(),
        email: z.string(),
        role: z.enum(["admin", "editor", "author", "subscriber"]),
      })
    )
    .describe("~6 staff accounts"),
  posts: z
    .array(
      z.object({
        title: z.string(),
        author: z.string(),
        date: z.string().describe("ISO 8601 date"),
        status: z.enum(["published", "draft", "pending"]),
      })
    )
    .describe("~8 blog posts / pages"),
  orders: z
    .array(
      z.object({
        number: z.string().describe("order number e.g. #1024"),
        customer: z.string(),
        total: z.string().describe("money incl. currency symbol, e.g. £129.00"),
        status: z.enum(["processing", "completed", "on-hold", "refunded", "cancelled"]),
      })
    )
    .describe("~6 WooCommerce orders"),
  customers: z
    .array(
      z.object({
        name: z.string(),
        email: z.string(),
        orders: z.number().int().describe("lifetime order count"),
      })
    )
    .describe("~6 customers"),
  plugins: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        active: z.boolean(),
      })
    )
    .describe("~2 installed plugins"),
});

export type FakeRow = { kind: string; payload: any };

// Generate realistic, on-brand fake CMS/store content for a honeypot admin panel.
export async function generateFakeData(
  brand: string,
  template: "wordpress" | "drupal"
): Promise<FakeRow[]> {
  const { object } = await generateObject({
    model: MODEL,
    schema: FakeDataSchema,
    system:
      "You generate realistic decoy admin data for a fictional business's " +
      `${template} site. Everything must look like a genuine small/medium ` +
      "business: real-sounding human names, plausible on-brand emails using the " +
      "brand's domain, natural post titles, believable order totals and dates in " +
      "the last ~2 years. Never use placeholders like 'user1', 'test', or " +
      "'example.com'. Include one 'admin' user. Return the requested counts.",
    prompt: `Business/brand name: "${brand}". Platform: ${template}.`,
  });

  const rows: FakeRow[] = [];
  for (const u of object.users) rows.push({ kind: "user", payload: u });
  for (const p of object.posts) rows.push({ kind: "post", payload: p });
  for (const o of object.orders) rows.push({ kind: "order", payload: o });
  for (const c of object.customers) rows.push({ kind: "customer", payload: c });
  for (const pl of object.plugins) rows.push({ kind: "plugin", payload: pl });
  return rows;
}
