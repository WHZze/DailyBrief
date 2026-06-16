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
 *   PUSH_REPORT_URL=<https://...>   # optional; the tappable URL in the notification
 *                                     — defaults to GitHub Pages URL in CI
 *                                     — omitted from push if neither is set
 *
 * The Bark API is a single HTTP GET — no auth header, no JSON body:
 *   https://api.day.app/{key}/{title}/{body}?url={clickURL}
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
  // Quietly skip — most users won't configure this. It's not an error
  // to leave it unset; the report exists on disk / gh-pages regardless.
  console.log("[notify] PUSH_BARK_KEY not set — skipping push notification");
  process.exit(0);
}

// Resolve the date of the report we're notifying about.
//   - explicit arg wins (e.g. `node scripts/notify.mjs 2026-05-20`)
//   - otherwise: today's date in REPORT_TZ (or system local if unset).
//     If that directory doesn't exist yet, fall back to the most recent
//     <YYYY-MM-DD>/ on disk so the script does something useful when
//     called manually before today's pipeline finishes.
const dateArg = process.argv[2];
const todayLocal = new Intl.DateTimeFormat("en-CA", {
  timeZone: process.env.REPORT_TZ?.trim() || undefined,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function reportDirExists(d) {
  return fs.existsSync(path.join("daily_reports", d));
}

let date;
if (dateArg) {
  date = dateArg;
  if (!reportDirExists(date)) {
    console.error(`[notify] no report directory: daily_reports/${date}`);
    process.exit(1);
  }
} else if (reportDirExists(todayLocal)) {
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

// Resolve the report URL that the notification links to.
// Order: explicit PUSH_REPORT_URL env var → auto-derive from GH env in CI → skip URL parameter.
let reportUrl = process.env.PUSH_REPORT_URL || "";

if (!reportUrl) {
  // In GitHub Actions, GITHUB_REPOSITORY is "owner/repo".
  // The default Pages URL for a user/org repo is https://<owner>.github.io/<repo>/
  const repo = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  if (repo && owner) {
    const repoName = repo.slice(repo.indexOf("/") + 1);
    reportUrl = `https://${owner}.github.io/${repoName}/`;
  }
}

// Build the Bark API URL.
// Title and body are path segments — URL-encode to handle Chinese characters.
const title = process.env.REPORT_LOCALE === "en" ? "Daily Brief Ready" : "今日简报已生成";
const bodySuffix = date;
const barkBase = `https://api.day.app/${encodeURIComponent(barkKey)}`;
const barkPath = `/${encodeURIComponent(title)}/${encodeURIComponent(bodySuffix)}`;
let barkUrl = `${barkBase}${barkPath}`;
if (reportUrl) {
  barkUrl += `?url=${encodeURIComponent(reportUrl)}`;
}

// Send the push notification. Node 18+ has stable global fetch.
try {
  const resp = await fetch(barkUrl);
  const respBody = await resp.text();
  if (!resp.ok) {
    console.warn(`[notify] Bark push failed (HTTP ${resp.status}): ${respBody.slice(0, 200)}`);
  } else {
    console.log(`[notify] Bark push sent for ${date}${reportUrl ? ` → ${reportUrl}` : ""}`);
  }
} catch (err) {
  // Non-fatal: the report is on disk / gh-pages regardless.
  console.warn(`[notify] Bark push failed (fetch error): ${err.message}`);
}
