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

// ── Sports (ESPN RSS → DeepSeek 中文翻译) ─────────────────────────────────
async function translateToChinese(headlines) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    // No key available — return English headlines with Chinese labels
    return headlines;
  }
  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "你是体育新闻翻译。将以下英文体育标题翻译成中文，要求：1)保留人名、队名、数字和专有名词 2)中文简洁有力，每条不超过30字 3)按原文顺序每行输出一条翻译，不要编号。",
          },
          { role: "user", content: headlines.join("\n") },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`DeepSeek HTTP ${resp.status}`);
    const d = await resp.json();
    const text = d.choices?.[0]?.message?.content || "";
    return text.split("\n").filter((l) => l.trim());
  } catch (e) {
    console.warn(`[extras] sports translation failed: ${e.message}`);
    return headlines; // fallback: English
  }
}

const SPORTS_CATEGORIES = ["比分", "转会", "赛程", "花絮", "深度"];

export async function fetchSports() {
  try {
    // Fetch ESPN global headlines
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
      const titleMatch =
        /<title><!\[CDATA\[(.*?)\]\]><\/title>/i.exec(block) ||
        /<title>(.*?)<\/title>/i.exec(block);
      if (titleMatch) items.push(titleMatch[1].trim());
    }

    if (items.length === 0) return "";
    const headlines = items.slice(0, 6);

    // Translate to Chinese (falls back to English if no API key)
    const zhHeadlines = await translateToChinese(headlines);

    // Assign emoji categories based on keyword matching
    const lines = zhHeadlines.map((t, i) => {
      const lower = t.toLowerCase();
      const emoji = lower.match(/比分|score|win|lose|defeat/)
        ? "⚡" : lower.match(/转会|transfer|sign|deal|contract/)
        ? "🔄" : lower.match(/受伤|injury|out|season/)
        ? "🏥" : lower.match(/决赛|final|champion|playoff|NBA|NFL|UEFA|FIFA/)
        ? "🏆" : "📰";
      return `${emoji} ${t}`;
    });

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
