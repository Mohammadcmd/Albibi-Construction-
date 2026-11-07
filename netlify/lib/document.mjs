// The shape of an invoice / estimate / bill, plus the maths. Claude fills in the
// fields; totals are always computed here, never by the model.
import { config } from "./config.mjs";
import { getStore } from "./store.mjs";

export const DOC_TYPES = ["invoice", "estimate", "bill"];

export const TYPE_LABELS = { invoice: "Invoice", estimate: "Estimate", bill: "Bill" };
const PREFIX = { invoice: "INV", estimate: "EST", bill: "BILL" };

const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : v == null ? "" : String(v).slice(0, max));
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : "");
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function emptyDocument(type = "invoice") {
  return normalizeDocument({ type });
}

// Coerces anything (model output, browser input) into a clean, safe document.
export function normalizeDocument(input = {}) {
  const d = input && typeof input === "object" ? input : {};
  const type = DOC_TYPES.includes(d.type) ? d.type : "invoice";
  const client = d.client || {};
  const project = d.project || {};
  const items = Array.isArray(d.line_items) ? d.line_items.slice(0, 200) : [];

  return {
    type,
    number: str(d.number, 40),
    date: date(d.date) || today(),
    due_date: date(d.due_date),
    client: {
      name: str(client.name, 200),
      company: str(client.company, 200),
      email: str(client.email, 200),
      phone: str(client.phone, 60),
      address: str(client.address, 500),
    },
    project: {
      name: str(project.name, 200),
      address: str(project.address, 500),
    },
    line_items: items
      .map((it) => ({
        description: str(it?.description, 500),
        details: str(it?.details, 1000),
        quantity: num(it?.quantity ?? 1),
        unit: str(it?.unit, 30),
        unit_price: num(it?.unit_price),
      }))
      .filter((it) => it.description || it.unit_price),
    tax_rate: Math.max(0, Math.min(100, num(d.tax_rate ?? config.company.defaultTaxRate))),
    discount: Math.max(0, num(d.discount)),
    amount_paid: Math.max(0, num(d.amount_paid)),
    notes: str(d.notes, 3000),
    terms: str(d.terms, 3000),
  };
}

export function computeTotals(doc) {
  const lines = doc.line_items.map((it) => round2(it.quantity * it.unit_price));
  const subtotal = round2(lines.reduce((a, b) => a + b, 0));
  const discount = round2(Math.min(doc.discount, subtotal));
  const taxable = round2(subtotal - discount);
  const tax = round2((taxable * doc.tax_rate) / 100);
  const total = round2(taxable + tax);
  const paid = round2(doc.amount_paid);
  return { lines, subtotal, discount, tax, total, paid, balance: round2(total - paid) };
}

export function formatMoney(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: config.company.currency }).format(n);
}

// Hands out INV-2026-0001, EST-2026-0001 ... Safe enough for a small team; two people
// pressing "Create PDF" in the very same instant could in theory get the same number.
export async function assignNumber(type) {
  const store = await getStore();
  const year = new Date().getFullYear();
  const key = `counter/${type}/${year}`;
  const current = (await store.get(key))?.value || 0;
  const next = current + 1;
  await store.set(key, { value: next });
  return `${PREFIX[type]}-${year}-${String(next).padStart(4, "0")}`;
}

export function fileName(doc) {
  const who = (doc.client.company || doc.client.name || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${TYPE_LABELS[doc.type]}-${doc.number || "draft"}${who ? "-" + who : ""}.pdf`;
}
