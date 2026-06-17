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

    // Hero headline
    if (report.hero_headline) {
      parts.push(isEn ? `📌 ${report.hero_headline}` : `📌 ${report.hero_headline}`);
    }

    // Daily overview (the key section — trim to ~300 chars)
    if (report.daily_overview) {
      let ov = report.daily_overview;
      if (ov.length > 350) ov = ov.slice(0, 350) + "…";
      parts.push(ov);
    }

    // Top briefs from each category (1-2 each)
    for (const cat of ["tech_briefs", "finance_briefs", "politics_briefs"]) {
      const briefs = report[cat];
      if (!Array.isArray(briefs) || briefs.length === 0) continue;
      const label =
        cat === "tech_briefs" ? (isEn ? "💻 Tech" : "💻 科技")
        : cat === "finance_briefs" ? (isEn ? "💰 Finance" : "💰 财经")
        : (isEn ? "🌍 World" : "🌍 时政");
      const items = briefs.slice(0, 2).map((b) => `· ${b.summary || b.headline || "?"}`);
      parts.push(`${label}\n${items.join("\n")}`);
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
// Append a hint about tapping
bodyText += isEn ? "\n\n👆 Tap to read full report" : "\n\n👆 轻点查看完整报告";

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
