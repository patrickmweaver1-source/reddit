// Reads public inboxes from FreePhoneNum.com only (fixed host, no user-supplied URLs).
// Other listed sites sit behind Cloudflare bot challenges, so they are link-only.
const BASE = "https://freephonenum.com";
const UA = "Mozilla/5.0 (compatible; FreeSMSInboxFinder/1.0)";

const decode = s => s
  .replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

const json = (status, body, maxAge = 30) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
  body: JSON.stringify(body),
});

async function get(path) {
  const r = await fetch(BASE + path, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.text();
}

function parseNumbers(html) {
  const seen = new Set(), out = [];
  for (const [, cc, num] of html.matchAll(/href="\/([a-z]{2})\/receive-sms\/(\d{6,15})"/g)) {
    const k = cc + num;
    if (!seen.has(k)) { seen.add(k); out.push({ cc, number: num }); }
  }
  return out;
}

function parseMessages(html) {
  const out = [];
  for (const block of html.split('<div class="msg"').slice(1)) {
    const text = block.match(/js-msgtext">([\s\S]*?)<\/div>/);
    if (!text) continue;
    const sender = block.match(/<span class="font-bold[^"]*">([\s\S]*?)<\/span>/);
    const from = block.match(/class="text-muted text-xs mono">([\s\S]*?)<\/a>/);
    const svc = block.match(/^[^>]*data-service="([^"]*)"/);
    out.push({
      service: svc ? decode(svc[1]) : "",
      sender: sender ? decode(sender[1]) : "",
      from: from ? decode(from[1]) : "",
      text: decode(text[1]),
    });
  }
  return out;
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  try {
    if (q.action === "numbers") {
      return json(200, { source: "FreePhoneNum", numbers: parseNumbers(await get("/receive-sms")) }, 300);
    }
    if (q.action === "messages") {
      if (!/^[a-z]{2}$/.test(q.cc || "") || !/^\d{6,15}$/.test(q.number || ""))
        return json(400, { error: "bad cc or number" }, 0);
      return json(200, { messages: parseMessages(await get(`/${q.cc}/receive-sms/${q.number}`)) }, 15);
    }
    return json(400, { error: "action must be numbers or messages" }, 0);
  } catch (e) {
    return json(502, { error: "Could not reach FreePhoneNum: " + e.message }, 0);
  }
};

exports._test = { parseNumbers, parseMessages };
