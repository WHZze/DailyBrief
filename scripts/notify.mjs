#!/usr/bin/env node
/**
 * Send push notification after report generation.
 *
 * Channels:
 *   - Bark (iOS): PUSH_BARK_KEY in .env.local or GH Secrets
 *
 * Triggered automatically by run-daily.mjs (local) and daily.yml (GitHub Actions).
 * Manual invocation:
 *   node scripts/notify.mjs              # today's report
 *   node scripts/notify.mjs 2026-05-20   # a specific date
 *
 * Configuration (in .env.local — gitignored, or GitHub Actions secrets/vars):
 *   PUSH_BARK_KEY=<device-key>      # from the Bark iOS app home screen
 *   PUSH_REPORT_URL=<https://...>   # optional; explicit tappable URL override
 *
 * The notification body contains an inline summary of the report (headlines +
 * overview), so you get the key info without needing to open the link.
 *
 * No-op if PUSH_BARK_KEY is not configured.
 */
import { config } from "dotenv";
// quiet: true suppresses dotenv v17's stdout banner advertising paid products.
config({ path: ".env.local", quiet: true });

import fs from "node:fs";
import path from "node:path";
import { getExtras } from "./content-extras.mjs";

const barkKey = process.env.PUSH_BARK_KEY;
if (!barkKey) {
  console.log("[notify] PUSH_BARK_KEY not set — skipping push notification");
  process.exit(0);
}

const isEn = process.env.REPORT_LOCALE === "en";

// ── Date resolution ────────────────────────────────────────────────────────
const dateArg = process.argv[2];
const todayLocal = new Intl.DateTimeFormat("en-CA", {
  timeZone: process.env.REPORT_TZ?.trim() || undefined,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function reportDir(d) {
  return path.join("daily_reports", d);
}
function jsonPath(d) {
  return path.join(reportDir(d), `${d}.json`);
}

let date;
if (dateArg) {
  date = dateArg;
  if (!fs.existsSync(reportDir(date))) {
    console.error(`[notify] no report directory: daily_reports/${date}`);
    process.exit(1);
  }
} else if (fs.existsSync(reportDir(todayLocal))) {
  date = todayLocal;
} else {
  const dirs = fs
    .readdirSync("daily_reports")
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
    .sort();
  if (dirs.length === 0) {
    console.error("[notify] no <YYYY-MM-DD>/ directories in daily_reports/");
    process.exit(1);
  }
  date = dirs[dirs.length - 1];
  console.log(`[notify] today (${todayLocal}) not generated yet, using latest: ${date}`);
}

// ── Build inline summary from report JSON ───────────────────────────────────
let bodyText = "";
const localJson = jsonPath(date);
if (fs.existsSync(localJson)) {
  try {
    const report = JSON.parse(fs.readFileSync(localJson, "utf8"));
    const parts = [];

    // 1. Hero headline
    if (report.hero_headline) {
      parts.push(`📌 ${report.hero_headline}`);
    }

    // 2. Daily overview
    if (report.daily_overview) {
      let ov = report.daily_overview;
      if (ov.length > 400) ov = ov.slice(0, 400) + "…";
      parts.push(ov);
    }

    // 3. News briefs — tech, finance, politics
    const catLabels = {
      tech_briefs: "💻 科技",
      finance_briefs: "💰 财经",
      politics_briefs: "🌍 时政",
    };
    for (const [cat, label] of Object.entries(catLabels)) {
      const briefs = report[cat];
      if (!Array.isArray(briefs) || briefs.length === 0) continue;
      const items = briefs.slice(0, 2).map(
        (b) => `· ${b.summary || b.headline || "?"}`
      );
      parts.push(`${label}\n${items.join("\n")}`);
    }

    // 4. Trading / market signals
    const trading = report.trading;
    if (trading) {
      const watchlist = trading.watchlist;
      if (Array.isArray(watchlist) && watchlist.length > 0) {
        // Pick key tickers: US majors + crypto + China
        const keySymbols = new Set([
          "SPY", "QQQ", "NVDA", "AAPL", "TSLA",
          "BTC", "ETH", "BABA", "0700.HK",
        ]);
        const highlights = watchlist
          .filter((t) => keySymbols.has(t.symbol))
          .map((t) => {
            const emoji = t.stance?.includes("上行") ? "🟢"
              : t.stance?.includes("下行") ? "🔴" : "⚪";
            return `${emoji} ${t.display_name || t.symbol}: ${t.stance || "—"}`;
          });
        if (highlights.length > 0) {
          parts.push(`📈 市场信号\n${highlights.join("\n")}`);
        }
        // Add crypto fear & greed if available
        const fg = trading.crypto_fear_greed;
        if (fg && fg.value != null) {
          const fgEmoji = fg.value > 60 ? "🟢" : fg.value > 40 ? "⚪" : "🔴";
          parts.push(`🪙 加密恐慌贪婪指数: ${fgEmoji} ${fg.value} (${fg.classification || ""})`);
        }
      }
    }

    // 5. Editor's note / global analysis
    if (report.editor_note) {
      parts.push(`🧠 全球观察\n${report.editor_note}`);
    }

    bodyText = parts.join("\n\n");
  } catch (err) {
    console.warn(`[notify] failed to read report JSON: ${err.message} — falling back to plain text`);
  }
}

// Fallback: plain date-only body if JSON couldn't be read
if (!bodyText) {
  bodyText = isEn
    ? `Daily Brief for ${date} is ready. Tap to read.`
    : `${date} 每日简报已生成，点击查看。`;
}

// ── Fetch extra content (sports, history, quote) ─────────────────────────
// Best-effort — failures are non-fatal, notification degrades gracefully.
console.log("[notify] fetching extras (sports, history, quote)…");
const extras = await getExtras();
if (extras) {
  bodyText += "\n\n" + extras;
}

// Append tap hint at the very end
bodyText += isEn
  ? "\n\n👆 Tap to read full report with charts & images"
  : "\n\n👆 轻点查看完整报告（含图表与图片）";

// ── Resolve tappable URL ────────────────────────────────────────────────────
// Priority: explicit PUSH_REPORT_URL → raw.githubusercontent.com in CI → none
let reportUrl = process.env.PUSH_REPORT_URL || "";

if (!reportUrl) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo) {
    // Route through ghfast.top — a GitHub raw-content proxy accessible
    // from mainland China where github.io IPs are blocked.
    const rawUrl = `https://raw.githubusercontent.com/${repo}/gh-pages/${date}/${date}.html`;
    reportUrl = `https://ghfast.top/${rawUrl}`;
  }
}

// ── Send via Bark POST API ──────────────────────────────────────────────────
// The GET API (/key/title/body) has URL length limits (~4KB). We use the
// POST endpoint so the inline summary can be rich without hitting 431 errors.
const title = isEn ? `📰 Daily Brief · ${date}` : `📰 每日简报 · ${date}`;

const payload = {
  device_key: barkKey,
  title,
  body: bodyText,
  group: "DailyBrief",
  level: "timeSensitive",
};
if (reportUrl) payload.url = reportUrl;

try {
  const resp = await fetch("https://api.day.app/push", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const respBody = await resp.text();
  if (!resp.ok) {
    console.warn(`[notify] Bark push failed (HTTP ${resp.status}): ${respBody.slice(0, 200)}`);
  } else {
    console.log(`[notify] Bark push sent for ${date}${reportUrl ? ` → ${reportUrl}` : ""}`);
  }
} catch (err) {
  console.warn(`[notify] Bark push failed (fetch error): ${err.message}`);
}
