import { requireSession } from "../lib/auth.mjs";
import { HttpError, handler, json } from "../lib/http.mjs";
import { getDocument, listDocuments } from "../lib/records.mjs";

// GET /api/documents           -> recent documents
// GET /api/documents?number=X  -> one document
export default handler("GET", async (req) => {
  requireSession(req);
  const number = new URL(req.url).searchParams.get("number");
  if (number) {
    const record = await getDocument(number);
    if (!record) throw new HttpError(404, "Document not found.");
    return json(record);
  }
  return json({ documents: await listDocuments() });
});

export const config = { path: "/api/documents" };
