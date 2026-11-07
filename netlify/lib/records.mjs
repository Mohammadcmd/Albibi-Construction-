// Saved documents, so anyone on the team can re-open, edit and resend them.
import { assignNumber, computeTotals, normalizeDocument } from "./document.mjs";
import { getStore } from "./store.mjs";

// Gives the document a number if it doesn't have one yet, and saves it.
export async function saveDocument(input, userEmail) {
  const doc = normalizeDocument(input);
  if (!doc.number) doc.number = await assignNumber(doc.type);
  const store = await getStore();
  const key = `docs/${doc.number}`;
  const existing = await store.get(key);
  const now = new Date().toISOString();
  await store.set(key, {
    document: doc,
    createdBy: existing?.createdBy || userEmail,
    createdAt: existing?.createdAt || now,
    updatedBy: userEmail,
    updatedAt: now,
    sentTo: existing?.sentTo || [],
  });
  return doc;
}

export async function markSent(number, recipients) {
  const store = await getStore();
  const key = `docs/${number}`;
  const record = await store.get(key);
  if (!record) return;
  record.sentTo = [...(record.sentTo || []), { to: recipients, at: new Date().toISOString() }];
  await store.set(key, record);
}

export async function getDocument(number) {
  const store = await getStore();
  return store.get(`docs/${number}`);
}

export async function listDocuments(limit = 100) {
  const store = await getStore();
  const keys = await store.list("docs/");
  const records = await Promise.all(keys.map((k) => store.get(k)));
  return records
    .filter(Boolean)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({
      number: r.document.number,
      type: r.document.type,
      date: r.document.date,
      client: r.document.client.company || r.document.client.name,
      project: r.document.project.name || r.document.project.address,
      total: computeTotals(r.document).total,
      createdBy: r.createdBy,
      updatedAt: r.updatedAt,
      sent: (r.sentTo || []).length > 0,
    }));
}
