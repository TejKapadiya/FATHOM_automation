/*
 * Fathom bulk sharing change - Chrome console script
 * --------------------------------------------------
 * For each call ID, this script:
 *   1. opens the call page in the background (/calls/<CALL_ID>)
 *   2. finds that call's share-token ID inside the page
 *   3. sends  PUT /share_tokens/<TOKEN_ID>  {"access":"universal_audience_restricted"}
 *      (the same request you captured)
 *   4. optionally adds an email to the call (ADD_EMAIL, off until you capture it)
 *
 * Before touching anything, it runs a self-test on your known pair
 * (call example call url from your account -> token). If it can't find the token correctly,
 * it stops and prints what it saw.
 *
 * Run it in a tab on https://fathom.video while signed in.
 */

(async () => {
  // ============================ CONFIG ============================
  const DRY_RUN  = true;    // true = find token IDs and print them, send nothing
  const LIMIT    = 1;       // how many calls to process; 0 = all
  const DELAY_MS = 1500;    // pause between calls

  const ACCESS = "universal_audience_restricted";

  // Known pair from your capture, used for the self-test
  const KNOWN_CALL_ID  = "url id";
  const KNOWN_TOKEN_ID = "token id";

  // Paste call IDs here: the number after fathom.video/calls/
  const CALL_IDS = [
    // "All call id's",
  ];

  // Optional: request that adds a specific email. Leave null until captured.
  // Use {{TOKEN}} for the share-token ID and {{CALL}} for the call ID.
  const ADD_EMAIL = null;
  /* Example shape - replace with the captured one:
  const ADD_EMAIL = {
    url: "https://fathom.video/share_tokens/{{TOKEN}}/REPLACE",
    method: "POST",
    body: JSON.stringify({ email: "person@example.com" }),
  };
  */
  // ================================================================

  const HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fill = (s, call, token) =>
    String(s).split("{{CALL}}").join(call).split("{{TOKEN}}").join(token);

  // Patterns that commonly hold the token id in the page HTML / embedded JSON
  const PATTERNS = [
    /share_tokens\/(\d+)/,
    /share_token(?:&quot;|["'])?\s*:\s*\{[^}]*?(?:&quot;|["'])?id(?:&quot;|["'])?\s*:\s*(\d+)/,
    /share_token_id(?:&quot;|["'])?\s*:\s*(?:&quot;|["'])?(\d+)/,
  ];

  async function getPage(callId) {
    const res = await fetch(`/calls/${callId}`, { credentials: "include" });
    if (!res.ok) throw new Error(`call page HTTP ${res.status}`);
    return res.text();
  }

  async function getTokenId(callId) {
    const html = await getPage(callId);
    for (const p of PATTERNS) {
      const m = html.match(p);
      if (m) return m[1];
    }
    return null;
  }

  // ---------- Self-test ----------
  console.log("%cSelf-test: looking up the token for the known call...", "font-weight:bold");
  let testToken;
  try { testToken = await getTokenId(KNOWN_CALL_ID); }
  catch (e) { return console.error("Self-test failed to load the call page:", e.message); }

  if (testToken !== KNOWN_TOKEN_ID) {
    console.error(`Self-test FAILED: found ${testToken}, expected ${KNOWN_TOKEN_ID}. Nothing was changed.`);
    const html = await getPage(KNOWN_CALL_ID);
    const at = html.indexOf(KNOWN_TOKEN_ID);
    if (at >= 0) {
      console.log("The token IS in the page. Copy this snippet and send it to Claude:");
      console.log(html.slice(Math.max(0, at - 250), at + 80));
    } else {
      console.log("The token is NOT in the page HTML - it is loaded by a separate request. " +
        "Use the Network-tab search (see instructions) to find which request returns it.");
    }
    return;
  }
  console.log(`✓ Self-test passed (call ${KNOWN_CALL_ID} -> token ${testToken})`);

  // ---------- Bulk run ----------
  if (!CALL_IDS.length) return console.warn("CALL_IDS is empty - paste your call IDs to continue.");

  const todo = LIMIT > 0 ? CALL_IDS.slice(0, LIMIT) : CALL_IDS;
  const ok = [], failed = [];
  console.log(`%cProcessing ${todo.length} call(s), DRY_RUN=${DRY_RUN}`, "font-weight:bold");

  for (const [i, raw] of todo.entries()) {
    const callId = String(raw).trim();
    const tag = `${i + 1}/${todo.length} call ${callId}`;
    try {
      const tokenId = await getTokenId(callId);
      if (!tokenId) throw new Error("token id not found on call page");

      if (DRY_RUN) {
        console.log(`[dry] ${tag} -> PUT /share_tokens/${tokenId} {"access":"${ACCESS}"}`);
      } else {
        const res = await fetch(`/share_tokens/${tokenId}`, {
          method: "PUT", headers: HEADERS, credentials: "include",
          body: JSON.stringify({ access: ACCESS }),
        });
        if (res.status === 429) { console.warn("Rate limited, waiting 30s"); await sleep(30000); }
        if (!res.ok) throw new Error(`share update HTTP ${res.status} ${await res.text().catch(() => "")}`);

        if (ADD_EMAIL) {
          const r2 = await fetch(fill(ADD_EMAIL.url, callId, tokenId), {
            method: ADD_EMAIL.method, headers: HEADERS, credentials: "include",
            body: ADD_EMAIL.body ? fill(ADD_EMAIL.body, callId, tokenId) : undefined,
          });
          if (!r2.ok) throw new Error(`add email HTTP ${r2.status} ${await r2.text().catch(() => "")}`);
        }
        console.log(`✓ ${tag} (token ${tokenId})`);
      }
      ok.push(callId);
    } catch (e) {
      console.warn(`✗ ${tag}: ${e.message}`);
      failed.push(callId);
    }
    await sleep(DELAY_MS);
  }

  console.log(`%cDone. ${ok.length} ok, ${failed.length} failed.`, "font-weight:bold");
  if (failed.length) console.log("Failed call IDs (paste into CALL_IDS to retry):", JSON.stringify(failed));
  window.fathomBulkResult = { ok, failed };
})();
