// Renders a document to a clean, professional Letter-size PDF using pdf-lib.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { config } from "./config.mjs";
import { TYPE_LABELS, computeTotals, formatMoney } from "./document.mjs";

const NAVY = rgb(0.106, 0.165, 0.227);
const ORANGE = rgb(0.91, 0.45, 0.1);
const GRAY = rgb(0.38, 0.43, 0.48);
const LIGHT = rgb(0.95, 0.96, 0.97);
const LINE = rgb(0.85, 0.87, 0.9);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48; // margin

// The standard PDF fonts only cover Latin-1; swap common "smart" characters and drop the rest.
function clean(text) {
  return String(text ?? "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•●]/g, "-")
    .replace(/ /g, " ")
    .replace(/\t/g, "    ")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

const qty = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export async function renderPdf(doc) {
  const pdf = await PDFDocument.create();
  const label = TYPE_LABELS[doc.type];
  pdf.setTitle(`${config.company.name} ${label} ${doc.number}`.trim());
  pdf.setAuthor(config.company.name);
  pdf.setCreator(config.company.name);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const totals = computeTotals(doc);

  let page;
  let y;

  const text = (str, x, yy, { size = 10, f = font, color = NAVY, align = "left", width = 0 } = {}) => {
    const s = clean(str);
    let xx = x;
    if (align !== "left") {
      const w = f.widthOfTextAtSize(s, size);
      xx = align === "right" ? x + width - w : x + (width - w) / 2;
    }
    page.drawText(s, { x: xx, y: yy, size, font: f, color });
  };

  // Word-wraps to a width, honouring line breaks. Returns an array of lines.
  const wrap = (str, width, size = 10, f = font) => {
    const out = [];
    for (const para of clean(str).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const attempt = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(attempt, size) <= width) {
          line = attempt;
          continue;
        }
        if (line) out.push(line);
        // Break very long words (e.g. URLs)
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  };

  // Columns of the line-item table
  const tableW = PAGE_W - 2 * M;
  const cols = { desc: M, qty: M + 300, unit: M + 345, rate: M + 395, amount: M + 455 };
  const descW = cols.qty - cols.desc - 12;

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 6, width: tableW, height: 22, color: NAVY });
    const o = { size: 9, f: bold, color: WHITE };
    text("DESCRIPTION", cols.desc + 8, y + 1, o);
    text("QTY", cols.qty, y + 1, { ...o, align: "right", width: 36 });
    text("UNIT", cols.unit, y + 1, { ...o, align: "center", width: 44 });
    text("RATE", cols.rate, y + 1, { ...o, align: "right", width: 56 });
    text("AMOUNT", cols.amount, y + 1, { ...o, align: "right", width: PAGE_W - M - cols.amount - 8 });
    y -= 28;
  };

  const newPage = (continued) => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: ORANGE });
    if (continued) {
      y = PAGE_H - 48;
      text(`${config.company.name} - ${label} ${doc.number}`, M, y, { size: 10, f: bold });
      text("continued", M, y, { size: 9, color: GRAY, align: "right", width: tableW });
      y -= 30;
    }
  };

  const ensure = (needed, withTableHeader = false) => {
    if (y - needed < 70) {
      newPage(true);
      if (withTableHeader) tableHeader();
    }
  };

  // ---- Letterhead -----------------------------------------------------------
  newPage(false);
  y = PAGE_H - 62;
  text(config.company.name.toUpperCase(), M, y, { size: 20, f: bold });
  const c = config.company;
  const companyLines = [
    ...(c.address ? c.address.split(/\n|\s*\|\s*/) : []),
    [c.phone, c.email].filter(Boolean).join("  |  "),
    c.website,
    c.license ? `License #${c.license}` : "",
  ].filter(Boolean);
  let cy = y - 18;
  for (const l of companyLines) {
    text(l, M, cy, { size: 9, color: GRAY });
    cy -= 12;
  }

  // Document title + meta (right side)
  const rightX = PAGE_W - M - 200;
  text(label.toUpperCase(), rightX, y, { size: 24, f: bold, color: ORANGE, align: "right", width: 200 });
  const meta = [
    [`${label} #`, doc.number || "DRAFT"],
    ["Date", formatDate(doc.date)],
  ];
  if (doc.due_date) meta.push([doc.type === "estimate" ? "Valid until" : "Due date", formatDate(doc.due_date)]);
  let my = y - 22;
  for (const [k, v] of meta) {
    text(k, rightX, my, { size: 9, color: GRAY });
    text(v, rightX, my, { size: 9, f: bold, align: "right", width: 200 });
    my -= 13;
  }

  y = Math.min(cy, my) - 14;
  page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 1, color: LINE });
  y -= 22;

  // ---- Bill to / Project ----------------------------------------------------
  const boxW = (tableW - 20) / 2;
  const block = (title, lines, x) => {
    text(title, x, y, { size: 8, f: bold, color: ORANGE });
    let by = y - 15;
    lines.forEach((l, i) => {
      for (const w of wrap(l, boxW, i === 0 ? 11 : 9.5, i === 0 ? bold : font)) {
        text(w, x, by, { size: i === 0 ? 11 : 9.5, f: i === 0 ? bold : font, color: i === 0 ? NAVY : GRAY });
        by -= i === 0 ? 14 : 12;
      }
    });
    return by;
  };
  const cl = doc.client;
  const billTo = [cl.company || cl.name || "-", cl.company && cl.name ? `Attn: ${cl.name}` : "", cl.address, cl.phone, cl.email].filter(Boolean);
  const pr = doc.project;
  const proj = [pr.name || (pr.address ? "Job site" : "-"), pr.address].filter(Boolean);
  const b1 = block(doc.type === "estimate" ? "PREPARED FOR" : "BILL TO", billTo, M);
  const b2 = block("PROJECT / JOB SITE", proj, M + boxW + 20);
  y = Math.min(b1, b2) - 18;

  // ---- Line items -----------------------------------------------------------
  tableHeader();
  if (!doc.line_items.length) {
    text("No items yet.", cols.desc + 8, y, { size: 10, color: GRAY });
    y -= 20;
  }
  doc.line_items.forEach((it, i) => {
    const descLines = wrap(it.description || "-", descW, 10, bold);
    const detailLines = it.details ? wrap(it.details, descW, 8.5) : [];
    const h = descLines.length * 13 + detailLines.length * 11 + 10;
    ensure(h, true);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - h + 13, width: tableW, height: h, color: LIGHT });
    const top = y;
    descLines.forEach((l) => {
      text(l, cols.desc + 8, y, { size: 10, f: bold });
      y -= 13;
    });
    detailLines.forEach((l) => {
      text(l, cols.desc + 8, y, { size: 8.5, color: GRAY });
      y -= 11;
    });
    text(qty(it.quantity), cols.qty, top, { size: 10, align: "right", width: 36 });
    text(it.unit, cols.unit, top, { size: 9, color: GRAY, align: "center", width: 44 });
    text(formatMoney(it.unit_price), cols.rate, top, { size: 10, align: "right", width: 56 });
    text(formatMoney(totals.lines[i]), cols.amount, top, { size: 10, f: bold, align: "right", width: PAGE_W - M - cols.amount - 8 });
    y -= 10;
  });
  page.drawLine({ start: { x: M, y: y + 6 }, end: { x: PAGE_W - M, y: y + 6 }, thickness: 1, color: LINE });
  y -= 12;

  // ---- Totals ---------------------------------------------------------------
  const rows = [["Subtotal", totals.subtotal]];
  if (totals.discount) rows.push(["Discount", -totals.discount]);
  if (doc.tax_rate) rows.push([`Tax (${doc.tax_rate}%)`, totals.tax]);
  const showBalance = totals.paid > 0;
  ensure(rows.length * 16 + (showBalance ? 60 : 36));
  const tx = PAGE_W - M - 230;
  for (const [k, v] of rows) {
    text(k, tx, y, { size: 10, color: GRAY });
    text(formatMoney(v), tx, y, { size: 10, align: "right", width: 222 });
    y -= 16;
  }
  y -= 8;
  const totalLabel = doc.type === "estimate" ? "ESTIMATED TOTAL" : "TOTAL";
  page.drawRectangle({ x: tx - 8, y: y - 9, width: 238, height: 26, color: showBalance ? LIGHT : NAVY });
  text(totalLabel, tx, y, { size: 11, f: bold, color: showBalance ? NAVY : WHITE });
  text(formatMoney(totals.total), tx, y, { size: 12, f: bold, color: showBalance ? NAVY : WHITE, align: "right", width: 222 });
  y -= 30;
  if (showBalance) {
    text("Paid / deposit", tx, y, { size: 10, color: GRAY });
    text(formatMoney(-totals.paid), tx, y, { size: 10, align: "right", width: 222 });
    y -= 20;
    page.drawRectangle({ x: tx - 8, y: y - 9, width: 238, height: 26, color: NAVY });
    text("BALANCE DUE", tx, y, { size: 11, f: bold, color: WHITE });
    text(formatMoney(totals.balance), tx, y, { size: 12, f: bold, color: WHITE, align: "right", width: 222 });
    y -= 30;
  }
  y -= 10;

  // ---- Notes & terms --------------------------------------------------------
  const terms = doc.terms || (doc.type === "estimate" ? c.estimateTerms : c.defaultTerms);
  for (const [title, body] of [["NOTES", doc.notes], ["TERMS", terms]]) {
    if (!body) continue;
    const lines = wrap(body, tableW, 9);
    ensure(30);
    text(title, M, y, { size: 8, f: bold, color: ORANGE });
    y -= 14;
    for (const l of lines) {
      ensure(14);
      text(l, M, y, { size: 9, color: GRAY });
      y -= 12;
    }
    y -= 12;
  }

  if (doc.type === "estimate") {
    ensure(50);
    y -= 16;
    page.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.8, color: NAVY });
    page.drawLine({ start: { x: M + 260, y }, end: { x: M + 400, y }, thickness: 0.8, color: NAVY });
    text("Customer acceptance (signature)", M, y - 12, { size: 8, color: GRAY });
    text("Date", M + 260, y - 12, { size: 8, color: GRAY });
  }

  // ---- Footer on every page -------------------------------------------------
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: M, y: 46 }, end: { x: PAGE_W - M, y: 46 }, thickness: 0.5, color: LINE });
    text(`Thank you for choosing ${config.company.name}.`, M, 32, { size: 8, color: GRAY });
    text(`Page ${i + 1} of ${pages.length}`, M, 32, { size: 8, color: GRAY, align: "right", width: tableW });
  });

  return pdf.save();
}
