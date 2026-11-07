import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "albibi-"));

const auth = await import("../netlify/lib/auth.mjs");
const { normalizeDocument, computeTotals } = await import("../netlify/lib/document.mjs");
const { renderPdf } = await import("../netlify/lib/pdf.mjs");
const { runAssistant } = await import("../netlify/lib/assistant.mjs");
const { saveDocument } = await import("../netlify/lib/records.mjs");

test("only albibiconstruction.com addresses are accepted", () => {
  assert.equal(auth.normalizeEmail("John.Smith"), "john.smith@albibiconstruction.com");
  assert.equal(auth.normalizeEmail(" mo@AlbibiConstruction.com "), "mo@albibiconstruction.com");
  assert.throws(() => auth.normalizeEmail("me@gmail.com"), /Only @albibiconstruction.com/);
  assert.throws(() => auth.normalizeEmail("a@b@albibiconstruction.com"));
  assert.throws(() => auth.normalizeEmail("bad name"));
  assert.throws(() => auth.normalizeEmail(""));
});

test("login code works once, rejects wrong codes and locks after 5 tries", async () => {
  const email = "worker@albibiconstruction.com";
  const code = await auth.createLoginCode(email);
  assert.match(code, /^\d{6}$/);
  const wrong = code === "000000" ? "111111" : "000000";
  await assert.rejects(auth.verifyLoginCode(email, wrong), /Wrong code/);
  await auth.verifyLoginCode(email, code);
  await assert.rejects(auth.verifyLoginCode(email, code), /expired/); // single use

  const email2 = "other@albibiconstruction.com";
  const code2 = await auth.createLoginCode(email2);
  const bad = code2 === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await assert.rejects(auth.verifyLoginCode(email2, bad));
  await assert.rejects(auth.verifyLoginCode(email2, code2), /Too many/);
});

test("code requests are rate limited", async () => {
  const email = "spam@albibiconstruction.com";
  for (let i = 0; i < 5; i++) await auth.createLoginCode(email);
  await assert.rejects(auth.createLoginCode(email), /Too many codes/);
});

test("session cookie round-trips and rejects tampering", () => {
  const cookie = auth.createSessionCookie("a@albibiconstruction.com").split(";")[0];
  const req = (c) => new Request("https://x/", { headers: { cookie: c } });
  assert.deepEqual(auth.getSession(req(cookie)), { email: "a@albibiconstruction.com" });
  const [name, token] = cookie.split("=");
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ email: "boss@albibiconstruction.com", exp: Date.now() + 1e9 })).toString("base64url");
  assert.equal(auth.getSession(req(`${name}=${forged}.${sig}`)), null);
  assert.equal(auth.getSession(req(`${name}=${payload}.x${sig.slice(1)}`)), null);
  assert.equal(auth.getSession(req("")), null);
});

test("totals: discount, tax, deposit", () => {
  const doc = normalizeDocument({
    line_items: [
      { description: "Labor", quantity: 3, unit: "day", unit_price: 600 },
      { description: "Lumber", quantity: 1, unit_price: "$1,234.56" },
    ],
    tax_rate: 8.25, discount: 100, amount_paid: 500,
  });
  const t = computeTotals(doc);
  assert.equal(t.subtotal, 3034.56);
  assert.equal(t.tax, 242.1); // (3034.56 - 100) * 8.25%
  assert.equal(t.total, 3176.66);
  assert.equal(t.balance, 2676.66);
});

test("normalizeDocument drops junk and unknown types", () => {
  const doc = normalizeDocument({ type: "hack", line_items: [{}, { description: "x", quantity: "2", unit_price: "5" }], date: "nope" });
  assert.equal(doc.type, "invoice");
  assert.equal(doc.line_items.length, 1);
  assert.equal(doc.line_items[0].quantity, 2);
  assert.match(doc.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("PDF renders, including many items, unicode and long text", async () => {
  const doc = normalizeDocument({
    type: "estimate", number: "EST-2026-0001",
    client: { name: "José Müller — “Owner”", address: "1 Long Road\nSuite 2" },
    line_items: Array.from({ length: 60 }, (_, i) => ({
      description: `Item ${i} ✓ with a fairly long description that needs to wrap onto another line in the table`,
      details: i % 3 ? "" : "Some details • here",
      quantity: i + 1, unit: "ea", unit_price: 12.5,
    })),
    notes: "word ".repeat(400),
  });
  const bytes = await renderPdf(doc);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const { PDFDocument } = await import("pdf-lib");
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  assert.ok(pages >= 3, `expected several pages, got ${pages}`);
});

test("documents get sequential numbers and keep them on re-save", async () => {
  const a = await saveDocument({ type: "invoice" }, "a@albibiconstruction.com");
  const b = await saveDocument({ type: "invoice" }, "a@albibiconstruction.com");
  const e = await saveDocument({ type: "estimate" }, "a@albibiconstruction.com");
  const year = new Date().getFullYear();
  assert.equal(a.number, `INV-${year}-0001`);
  assert.equal(b.number, `INV-${year}-0002`);
  assert.equal(e.number, `EST-${year}-0001`);
  assert.equal((await saveDocument(a, "b@albibiconstruction.com")).number, a.number);
});

test("assistant: sends context to Claude and normalizes its output", async () => {
  let sent;
  const fake = {
    beta: {
      messages: {
        create: async (req) => {
          sent = req;
          return {
            stop_reason: "end_turn",
            content: [{
              type: "text",
              text: JSON.stringify({
                reply: "Added the deck demo. What's the customer's name?",
                document: {
                  type: "invoice", date: "2026-11-07", due_date: "",
                  client: { name: "", company: "", email: "", phone: "", address: "" },
                  project: { name: "Deck", address: "45 Oak Ave" },
                  line_items: [{ description: "Deck demolition", details: "", quantity: 1, unit: "job", unit_price: 850 }],
                  tax_rate: 0, discount: 0, amount_paid: 0, notes: "", terms: "",
                },
              }),
            }],
          };
        },
      },
    },
  };
  const result = await runAssistant({
    history: [{ role: "assistant", content: "hi" }, { role: "user", content: "tore out deck at 45 oak ave, 850" }],
    document: { number: "INV-2026-0009" },
    userEmail: "a@albibiconstruction.com",
    client: fake,
  });
  assert.equal(result.document.line_items[0].unit_price, 850);
  assert.equal(result.document.number, "INV-2026-0009"); // number preserved
  assert.match(result.reply, /customer/);
  assert.equal(sent.messages[0].role, "user"); // leading assistant turn dropped
  assert.match(sent.messages.at(-1).content, /<current_document>/);
  assert.equal(sent.output_config.format.type, "json_schema");
});
