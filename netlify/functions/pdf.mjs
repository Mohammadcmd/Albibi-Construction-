import { requireSession } from "../lib/auth.mjs";
import { fileName } from "../lib/document.mjs";
import { handler, readJson } from "../lib/http.mjs";
import { renderPdf } from "../lib/pdf.mjs";
import { saveDocument } from "../lib/records.mjs";

// Saves the document (assigning a number the first time) and returns the PDF.
export default handler("POST", async (req) => {
  const { email } = requireSession(req);
  const { document } = await readJson(req);
  const doc = await saveDocument(document, email);
  const bytes = await renderPdf(doc);
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${fileName(doc)}"`,
      "x-document": encodeURIComponent(JSON.stringify(doc)),
      "cache-control": "no-store",
    },
  });
});

export const config = { path: "/api/pdf" };
