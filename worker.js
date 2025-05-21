const SQLITE_SAFE_LIMIT = 100; 

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function updatePrefixes(asn, env) {
  const RIPE_URL = `https://stat.ripe.net/data/announced-prefixes/data.json?resource=${asn}`;
  const response = await fetch(RIPE_URL);

  if (!response.ok) throw new Error(`Failed to fetch ${asn}: ${response.statusText}`);
  if (!/^[A-Z0-9]+$/.test(asn)) throw new Error(`Invalid ASN format: ${asn}`);

  const data = await response.json();
  const now = new Date().toISOString();
  const currentPrefixes = data.data.prefixes.map(p => p.prefix);
  const tableName = asn;

  console.log(`[${asn}] Total prefixes from RIPE: ${currentPrefixes.length}`);

  // STEP 1: Mark all as inactive
  console.log(`[${asn}] Marking all records as inactive...`);
  await env.DB.prepare(`UPDATE ${tableName} SET active = FALSE`).run();

  // STEP 2: Re-activate current prefixes in safe chunks
  console.log(`[${asn}] Re-activating current prefixes in chunks of ${SQLITE_SAFE_LIMIT}...`);
  const chunks = chunkArray(currentPrefixes, SQLITE_SAFE_LIMIT);
  for (const [i, chunk] of chunks.entries()) {
    if (chunk.length === 0) continue;

    const placeholders = chunk.map(() => '?').join(',');
    const stmt = `UPDATE ${tableName} SET active = TRUE WHERE prefix IN (${placeholders})`;

    console.log(`[${asn}] Chunk ${i + 1}/${chunks.length} — ${chunk.length} prefixes`);

    try {
      await env.DB.prepare(stmt).bind(...chunk).run();
    } catch (err) {
      console.error(`[${asn}] Failed to run chunk ${i + 1} — ${chunk.length} variables`);
      console.error(err.stack || err.message);
      throw err;
    }
  }

// STEP 3: Batch upserts
console.log(`[${asn}] Upserting prefixes in chunks of ${SQLITE_SAFE_LIMIT}...`);
const insertChunks = chunkArray(currentPrefixes, Math.floor(SQLITE_SAFE_LIMIT / 2)); // 2 vars per prefix

for (const [i, chunk] of insertChunks.entries()) {
  const values = chunk.flatMap(prefix => [prefix, now]); // 2 values per row
  const placeholders = chunk.map(() => `(?, TRUE, ?)`).join(',');
  const stmt = `
    INSERT INTO ${tableName} (prefix, active, last_seen_at)
    VALUES ${placeholders}
    ON CONFLICT(prefix) DO UPDATE
    SET active = TRUE, last_seen_at = excluded.last_seen_at
  `;

  try {
    console.log(`[${asn}] Upsert chunk ${i + 1}/${insertChunks.length} — ${chunk.length} rows`);
    await env.DB.prepare(stmt).bind(...values).run();
  } catch (err) {
    console.error(`[${asn}] Failed batch upsert chunk ${i + 1}`);
    throw err;
  }
}


  return { asn, count: currentPrefixes.length };
}

export default {
  async scheduled(event, env, ctx) {
    const asn = env.ASN || "AS14593";
    console.log(`[CRON] Updating ASN: ${asn}`);
    try {
      await updatePrefixes(asn, env);
      console.log(`[CRON] Completed update for ${asn}`);
    } catch (err) {
      console.error(`[CRON] Failed update for ${asn}:`, err);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/update") {
      const asn = url.searchParams.get("asn");
      if (!asn) return new Response("Missing ?asn=ASxxxxx", { status: 400 });

      console.log(`[HTTP] Received update request for ${asn}`);

      try {
        const result = await updatePrefixes(asn, env);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error(`[HTTP] Error updating ${asn}:`, err);
        return new Response(`Error: ${err.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
