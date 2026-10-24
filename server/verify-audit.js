
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, "storage", "trustvault.db");
const db = new Database(dbPath, { readonly: true });

try {
  const events = db.prepare(`
    SELECT
      id,
      action,
      previous_hash,
      event_hash,
      event_payload
    FROM audit_events
    ORDER BY id ASC
  `).all();

  const head = db.prepare(`
    SELECT event_hash
    FROM audit_heads
    WHERE id = 1
  `).get();

  let verified = 0;
  let missingPayloads = 0;
  let hashFailures = 0;
  let linkFailures = 0;
  let previousEventHash = null;

  for (const event of events) {
    if (event.previous_hash !== previousEventHash) {
      console.error(
        `CHAIN LINK MISMATCH: event ${event.id}; expected previous_hash ${previousEventHash}, got ${event.previous_hash}`
      );
      linkFailures++;
    }

    if (!event.event_payload) {
      console.warn(
        `UNVERIFIABLE PAYLOAD: event ${event.id} (${event.action}) has no stored payload`
      );
      missingPayloads++;
    } else {
      const calculatedHash = createHash("sha256")
        .update(event.event_payload)
        .digest("hex");

      if (calculatedHash !== event.event_hash) {
        console.error(`HASH MISMATCH: event ${event.id}`);
        hashFailures++;
      } else {
        verified++;
      }
    }

    previousEventHash = event.event_hash;
  }

  if (events.length > 0 && head?.event_hash !== previousEventHash) {
    console.error("AUDIT HEAD MISMATCH: audit_heads does not match the latest event");
    linkFailures++;
  }

  if (events.length === 0 && head) {
    console.error("AUDIT HEAD EXISTS BUT THERE ARE NO EVENTS");
    linkFailures++;
  }

  console.log("\n--- Audit Verification Summary ---");
  console.log(`Total events: ${events.length}`);
  console.log(`Payload hashes verified: ${verified}`);
  console.log(`Events missing payloads: ${missingPayloads}`);
  console.log(`Hash failures: ${hashFailures}`);
  console.log(`Chain/head failures: ${linkFailures}`);

  if (hashFailures > 0 || linkFailures > 0) {
    console.log("RESULT: FAILED — investigate the reported mismatches.");
    process.exitCode = 1;
  } else if (missingPayloads > 0) {
    console.log(
      "RESULT: INCOMPLETE — stored payload hashes passed, but older events cannot be fully verified."
    );
  } else {
    console.log("RESULT: PASSED — all payload hashes and chain links verified.");
  }
} finally {
  db.close();
}
