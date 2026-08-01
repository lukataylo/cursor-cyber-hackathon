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

type FakeData = z.infer<typeof FakeDataSchema>;

export type FakeRow = { kind: string; payload: any };

// Turn a brand into a plausible email domain, e.g. "Acme Tools" -> "acmetools.com".
function brandDomain(brand: string): string {
  const slug = (brand || "acme")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return `${slug || "acme"}.com`;
}

function flatten(object: FakeData): FakeRow[] {
  const rows: FakeRow[] = [];
  for (const u of object.users ?? []) rows.push({ kind: "user", payload: u });
  for (const p of object.posts ?? []) rows.push({ kind: "post", payload: p });
  for (const o of object.orders ?? []) rows.push({ kind: "order", payload: o });
  for (const c of object.customers ?? []) rows.push({ kind: "customer", payload: c });
  for (const pl of object.plugins ?? []) rows.push({ kind: "plugin", payload: pl });
  return rows;
}

// Deterministic, on-brand static content used whenever the LLM call fails or
// returns nothing. Keeps the decoy admin populated so it never looks broken.
function staticFallback(brand: string, template: "wordpress" | "drupal"): FakeRow[] {
  const dom = brandDomain(brand);
  const b = brand || "Acme";
  const object: FakeData = {
    users: [
      { username: "sarah.mitchell", email: `sarah.mitchell@${dom}`, role: "admin" },
      { username: "j.oconnor", email: `james.oconnor@${dom}`, role: "editor" },
      { username: "priya.nair", email: `priya.nair@${dom}`, role: "editor" },
      { username: "tom.whitfield", email: `tom.whitfield@${dom}`, role: "author" },
      { username: "l.zhang", email: `lily.zhang@${dom}`, role: "author" },
      { username: "marcus.reed", email: `marcus.reed@${dom}`, role: "subscriber" },
    ],
    posts: [
      { title: `${b} Spring Collection Now Live`, author: "sarah.mitchell", date: "2025-04-12", status: "published" },
      { title: "5 Ways to Get the Most From Your Order", author: "j.oconnor", date: "2025-03-28", status: "published" },
      { title: "Behind the Scenes: Our Supply Chain", author: "priya.nair", date: "2025-02-15", status: "published" },
      { title: "Customer Stories: Real Results", author: "tom.whitfield", date: "2025-01-30", status: "published" },
      { title: "Shipping & Returns, Explained", author: "j.oconnor", date: "2024-12-11", status: "published" },
      { title: `A Message From the ${b} Team`, author: "sarah.mitchell", date: "2024-11-02", status: "published" },
      { title: "Holiday Gift Guide (Draft)", author: "l.zhang", date: "2025-05-01", status: "draft" },
      { title: "New Loyalty Programme — Coming Soon", author: "priya.nair", date: "2025-05-06", status: "pending" },
    ],
    orders: [
      { number: "#1042", customer: "Eleanor Hughes", total: "£129.00", status: "completed" },
      { number: "#1043", customer: "David Osei", total: "£54.99", status: "completed" },
      { number: "#1044", customer: "Grace Bennett", total: "£312.50", status: "processing" },
      { number: "#1045", customer: "Ahmed Farouk", total: "£19.95", status: "on-hold" },
      { number: "#1046", customer: "Chloe Andersson", total: "£88.00", status: "refunded" },
      { number: "#1047", customer: "Ryan Doyle", total: "£245.75", status: "completed" },
    ],
    customers: [
      { name: "Eleanor Hughes", email: "eleanor.hughes@gmail.com", orders: 7 },
      { name: "David Osei", email: "d.osei@outlook.com", orders: 3 },
      { name: "Grace Bennett", email: "grace.bennett@yahoo.co.uk", orders: 12 },
      { name: "Ahmed Farouk", email: "ahmed.farouk@gmail.com", orders: 1 },
      { name: "Chloe Andersson", email: "chloe.a@icloud.com", orders: 5 },
      { name: "Ryan Doyle", email: "ryan.doyle@gmail.com", orders: 9 },
    ],
    plugins:
      template === "drupal"
        ? [
            { name: "Webform", version: "6.2.4", active: true },
            { name: "Pathauto", version: "1.13.0", active: true },
          ]
        : [
            { name: "WooCommerce", version: "9.6.1", active: true },
            { name: "Yoast SEO", version: "24.3", active: true },
          ],
  };
  return flatten(object);
}

// Generate realistic, on-brand fake CMS/store content for a honeypot admin panel.
// Never throws: any LLM/parse/validation failure degrades to a static set so the
// decoy admin is always populated.
export async function generateFakeData(
  brand: string,
  template: "wordpress" | "drupal"
): Promise<FakeRow[]> {
  try {
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

    const rows = flatten(object);
    // If the model returned an empty/degenerate object, use the static set instead.
    if (rows.length < 5) return staticFallback(brand, template);
    return rows;
  } catch {
    return staticFallback(brand, template);
  }
}
