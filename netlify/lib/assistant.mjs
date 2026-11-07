// The conversational assistant: turns free-form talk ("bill Mike for the deck,
// 3 days labour at 600 a day plus 1,200 in lumber") into a structured document.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.mjs";
import { HttpError } from "./http.mjs";
import { normalizeDocument, today } from "./document.mjs";

let client;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

const s = { type: "string" };
const n = { type: "number" };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const OUTPUT_SCHEMA = obj({
  reply: s,
  document: obj({
    type: { type: "string", enum: ["invoice", "estimate", "bill"] },
    date: s,
    due_date: s,
    client: obj({ name: s, company: s, email: s, phone: s, address: s }),
    project: obj({ name: s, address: s }),
    line_items: {
      type: "array",
      items: obj({ description: s, details: s, quantity: n, unit: s, unit_price: n }),
    },
    tax_rate: n,
    discount: n,
    amount_paid: n,
    notes: s,
    terms: s,
  }),
});

const SYSTEM = `You are the office assistant for ${config.company.name}, a construction company. Crew members and office staff talk to you casually - often typed quickly on a phone or dictated by voice, in any order - and you turn what they say into a professional invoice, estimate or bill.

Each turn you receive the current document as JSON plus the user's latest message. Return the full updated document and a short reply.

How to fill the document:
- type: "invoice" (requesting payment for work done), "estimate" (a quote for future work) or "bill". Switch it only when the user asks for a different kind of document.
- Keep everything already in the document unless the user changes or removes it. Merge new details in; never drop line items the user did not ask to remove.
- line_items: one line per distinct piece of work or material. Rewrite rough wording into clear, professional descriptions (e.g. "tore out old deck" -> "Demolition and removal of existing deck"). Put extra specifics in "details" (short, optional). For day/hour/sq ft/each pricing set quantity, unit ("day", "hr", "sq ft", "ea", "lf") and unit_price. For a flat price use quantity 1, unit "job" (or "" for materials lump sums), unit_price = the price.
- Prices: use exactly the numbers the user gives. Never invent or guess a price. If an item has no price yet, add it with unit_price 0 and ask for the price in your reply.
- If the user gives a total for several things without a breakdown, use a single line for it rather than inventing a split.
- client: the customer being billed. project: the job name and the job site address ("where" the work was done).
- Dates are YYYY-MM-DD. Today is provided with each message. "date" defaults to today. For invoices and bills set due_date only if the user mentions one (e.g. "due in 15 days" -> today + 15). For estimates due_date means "valid until"; leave it empty unless mentioned.
- tax_rate is a percentage (8.25 means 8.25%). discount and amount_paid (deposits or payments already received) are dollar amounts.
- notes: anything the customer should read (scope notes, exclusions, warranty, thank-you). terms: payment terms, only if the user states them; otherwise leave empty and standard terms are added automatically.
- Leave unknown text fields as "" and unknown numbers as 0. Do not make up names, addresses, phone numbers or emails.

The reply:
- 1-3 short, friendly sentences in plain text (no markdown, no lists). Say what you added or changed.
- If something important is missing (customer name, a price for an item), ask for it briefly - at most two questions at a time. Do not nag about optional details like phone numbers.
- Do not state totals or do arithmetic in the reply - the app calculates and shows totals.
- If the message is not about a document (a greeting, a question), answer briefly and return the document unchanged.`;

const MAX_HISTORY = 30;

// history: [{ role: "user" | "assistant", content: string }], oldest first, ending with the new user message.
export async function runAssistant({ history, document, userEmail, client: injected }) {
  const current = normalizeDocument(document);
  const turns = (Array.isArray(history) ? history : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    throw new HttpError(400, "Please type a message.");
  }

  // Volatile context goes on the newest user turn so the system prompt stays cacheable.
  const last = turns[turns.length - 1];
  const { number, ...forModel } = current;
  last.content =
    `<today>${today()}</today>\n<signed_in_as>${userEmail}</signed_in_as>\n` +
    `<current_document>${JSON.stringify(forModel)}</current_document>\n\n${last.content}`;

  let response;
  try {
    response = await (injected || getClient()).beta.messages.create({
      model: config.anthropicModel,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: config.anthropicEffort,
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: turns,
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic auth error - check ANTHROPIC_API_KEY");
      throw new HttpError(500, "The assistant is not set up yet (API key problem).");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, "The assistant is busy right now. Please try again in a moment.");
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error", err.status, err.message);
      throw new HttpError(502, "The assistant had a problem. Please try again.");
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    return { reply: "Sorry, I can't help with that one. Try rephrasing what you need on the document.", document: current };
  }
  if (response.stop_reason === "max_tokens") {
    throw new HttpError(502, "That was too much for one message. Try sending it in smaller parts.");
  }

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("Assistant returned non-JSON output", text.slice(0, 500));
    throw new HttpError(502, "The assistant had a problem. Please try again.");
  }

  const updated = normalizeDocument({ ...parsed.document, number: current.number });
  // A number belongs to one type; changing invoice -> estimate needs a fresh number.
  if (updated.type !== current.type) updated.number = "";
  return { reply: String(parsed.reply || "Done."), document: updated };
}
