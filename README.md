This Cloudflare worker polls the RIPEstat API and gets the prefixes for an AS and puts them in a D1 database.

You need a D1 binding called "DB", and you need a table per ASN.

You need a table looks like this:
<code>
CREATE TABLE IF NOT EXISTS ASyourASNGoesHere (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TEXT NOT NULL
);
</code>
You can run the Worker as a cron, your can force a manual update with 

https://your-worker.goes-here.workers.dev/update?asn=AS14593
and this would get you all of the Starlink prefixes in AS14593.  
Hypothetically, you could use this with another script to manage Cloudflare Gateway Lists.  Hypothetically.
