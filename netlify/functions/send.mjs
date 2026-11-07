import { requireSession } from "../lib/auth.mjs";
import { TYPE_LABELS, computeTotals, fileName, formatMoney } from "../lib/document.mjs";
import { config as appConfig } from "../lib/config.mjs";
import { sendDocument } from "../lib/email.mjs";
import { HttpError, handler, json, readJson } from "../lib/http.mjs";
import { renderPdf } from "../lib/pdf.mjs";
import { markSent, saveDocument } from "../lib/records.mjs";

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const parseList = (v) =>
  (Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/)).map((e) => String(e).trim()).filter(Boolean);

// Emails the PDF to the customer. Replies go straight to the worker who sent it.
export default handler("POST", async (req) => {
  const { email } = requireSession(req);
  const body = await readJson(req);
  const to = parseList(body.to);
  const cc = parseList(body.cc);
  if (!to.length) throw new HttpError(400, "Add the customer's email address.");
  if (to.length + cc.length > 10) throw new HttpError(400, "Too many recipients.");
  for (const addr of [...to, ...cc]) {
    if (!EMAIL_RE.test(addr)) throw new HttpError(400, `"${addr}" doesn't look like an email address.`);
  }

  const doc = await saveDocument(body.document, email);
  const label = TYPE_LABELS[doc.type];
  const company = appConfig.company.name;
  const total = formatMoney(computeTotals(doc).balance);
  const subject = String(body.subject || `${label} ${doc.number} from ${company}`).slice(0, 200);
  const greeting = doc.client.name ? `Hi ${doc.client.name.split(" ")[0]},` : "Hello,";
  const message =
    String(body.message || "").trim().slice(0, 5000) ||
    `${greeting}\n\nPlease find attached ${label.toLowerCase()} ${doc.number}` +
      `${doc.project.name ? ` for ${doc.project.name}` : ""} (${total}).\n\n` +
      `If you have any questions, just reply to this email.\n\nThank you,\n${company}`;

  const pdf = await renderPdf(doc);
  await sendDocument({ to, cc, replyTo: email, subject, message, filename: fileName(doc), pdf });
  await markSent(doc.number, [...to, ...cc]);
  return json({ ok: true, document: doc });
});

export const config = { path: "/api/send" };
