// Key/value storage. On Netlify this uses Netlify Blobs (no setup needed);
// locally it falls back to JSON files in ./.data so the app runs without Netlify.
import { promises as fs } from "node:fs";
import path from "node:path";

let cached;

function onNetlify() {
  return Boolean(process.env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
}

async function netlifyStore() {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "albibi-office", consistency: "strong" });
  return {
    get: (key) => store.get(key, { type: "json" }),
    set: (key, value) => store.setJSON(key, value),
    delete: (key) => store.delete(key),
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

function fileStore() {
  const dir = path.resolve(process.env.LOCAL_DATA_DIR || ".data");
  const file = (key) => path.join(dir, encodeURIComponent(key) + ".json");
  return {
    async get(key) {
      try {
        return JSON.parse(await fs.readFile(file(key), "utf8"));
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },
    async set(key, value) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(key), JSON.stringify(value));
    },
    async delete(key) {
      await fs.rm(file(key), { force: true });
    },
    async list(prefix) {
      let names = [];
      try {
        names = await fs.readdir(dir);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      return names
        .filter((n) => n.endsWith(".json"))
        .map((n) => decodeURIComponent(n.slice(0, -5)))
        .filter((k) => k.startsWith(prefix));
    },
  };
}

export async function getStore() {
  if (!cached) cached = onNetlify() ? await netlifyStore() : fileStore();
  return cached;
}
