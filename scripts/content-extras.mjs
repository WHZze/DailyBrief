/**
 * Fetch extra content for the daily push notification.
 *
 * Sources (all free, no API key needed):
 *   - Sports: ESPN global RSS (espn.com)
 *   - Daily quote: Hitokoto (v1.hitokoto.cn)
 *   - Today in history: Wikipedia REST API
 *
 * All fetches are best-effort — failures are non-fatal.
 */

// ── Sports (ESPN RSS — global headlines) ───────────────────────────────────
export async function fetchSports() {
  try {
    const url = "https://www.espn.com/espn/rss/news";
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();

    // Minimal XML parser: extract <title> from each <item>
    const items = [];
    const re = /<item>[\s\S]*?<\/item>/gi;
    let match;
    while ((match = re.exec(xml)) !== null) {
      const block = match[0];
      const titleMatch = /<title><!\[CDATA\[(.*?)\]\]><\/title>/i.exec(block)
        || /<title>(.*?)<\/title>/i.exec(block);
      if (titleMatch) items.push(titleMatch[1].trim());
    }

    if (items.length === 0) return "";
    const lines = items.slice(0, 5).map((t) => `· ${t}`);
    return `⚽ 全球体育\n${lines.join("\n")}`;
  } catch (e) {
    console.warn(`[extras] sports fetch failed: ${e.message}`);
    return "";
  }
}

// ── Daily Quote (Hitokoto) ──────────────────────────────────────────────────
export async function fetchQuote() {
  try {
    const url = "https://v1.hitokoto.cn/?c=d&c=i&c=k&encode=json";
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json();
    const from = d.from ? ` — ${d.from}` : "";
    return `💬 ${d.hitokoto}${from}`;
  } catch (e) {
    console.warn(`[extras] quote fetch failed: ${e.message}`);
    return "";
  }
}

// ── Today in History (Wikipedia) ────────────────────────────────────────────
export async function fetchHistory() {
  try {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const url = `https://zh.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`;
    const resp = await fetch(url, {
      headers: { "Accept-Language": "zh-CN,zh;q=0.9" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json();
    const events = (d.selected || []).slice(0, 3);
    if (events.length === 0) return "";
    const lines = events.map((e) => `· ${e.year}年 ${e.text}`);
    return `📅 历史上的今天\n${lines.join("\n")}`;
  } catch (e) {
    console.warn(`[extras] history fetch failed: ${e.message}`);
    return "";
  }
}

// ── Aggregate extras ────────────────────────────────────────────────────────
export async function getExtras() {
  const [sports, quote, history] = await Promise.all([
    fetchSports(),
    fetchQuote(),
    fetchHistory(),
  ]);
  return [sports, history, quote].filter(Boolean).join("\n\n");
}
