// Smoke tests: boot the real server (no database, fake TMDB key) and check
// the parts that don't need TMDB — manifest, installer page, status page and
// the locked discovery endpoint. Run with `npm test`.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 7800 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
let server;

async function waitUntilUp() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/manifest.json`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not start in time");
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), TMDB_API_KEY: "test", DATABASE_URL: "", DISCOVER_SECRET: "" },
    stdio: "ignore"
  });
  await waitUntilUp();
});

after(() => {
  server?.kill();
});

const getJson = async (url, options) => {
  const res = await fetch(`${BASE}${url}`, options);
  return { status: res.status, body: await res.json() };
};

test("manifest has the standard catalogs and correct name", async () => {
  const { status, body } = await getJson("/manifest.json");
  assert.equal(status, 200);
  assert.equal(body.name, "Danish Nuvio Catalog");
  assert.equal(body.id, "dk.danish.nuvio.katalog");
  assert.equal(body.catalogs.length, 21);
  assert.ok(body.catalogs.every((c) => c.type && c.id && c.name));
  assert.ok(!body.catalogs.some((c) => c.id.startsWith("streaming_")), "opt-in catalogs must not be in the standard manifest");
});

test("personal install link can include opt-in catalogs", async () => {
  const config = Buffer.from(
    JSON.stringify({ ids: ["danske_film", "streaming_netflix_film", "samling_olsen_banden"], custom: [] })
  ).toString("base64url");
  const { status, body } = await getJson(`/c/${config}/manifest.json`);
  assert.equal(status, 200);
  assert.deepEqual(
    body.catalogs.map((c) => c.id),
    ["danske_film", "streaming_netflix_film", "samling_olsen_banden"]
  );
});

test("legacy comma-separated install links still work", async () => {
  const config = Buffer.from("danske_film,danske_serier").toString("base64url");
  const { body } = await getJson(`/c/${config}/manifest.json`);
  assert.deepEqual(body.catalogs.map((c) => c.id), ["danske_film", "danske_serier"]);
});

test("installer page renders", async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Danish Nuvio Catalog/);
});

test("status page works without a database", async () => {
  const { status, body } = await getJson("/status.json");
  assert.equal(status, 200);
  assert.equal(body.database.configured, false);
  assert.equal(body.catalogs.standard, 21);

  const page = await fetch(`${BASE}/status`);
  assert.equal(page.status, 200);
});

test("discovery endpoint is locked without the secret", async () => {
  const none = await fetch(`${BASE}/internal/discover`, { method: "POST" });
  assert.equal(none.status, 401);

  const wrong = await fetch(`${BASE}/internal/discover`, {
    method: "POST",
    headers: { Authorization: "Bearer not-the-secret" }
  });
  assert.equal(wrong.status, 401);
});
