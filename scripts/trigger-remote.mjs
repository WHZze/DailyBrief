#!/usr/bin/env node
/**
 * Trigger the remote GitHub Actions workflow via the workflow_dispatch API.
 *
 * This is a belt-and-suspenders backup for the GitHub schedule cron — macOS
 * launchd fires it at 08:03 local time (3 min after the target trigger).
 * If the GitHub schedule already built today's report, the concurrency group
 * on GitHub prevents a duplicate run.
 *
 * Also useful for iPhone Shortcuts automation — just call:
 *   curl -X POST -H "Authorization: Bearer <token>" \
 *     -H "Accept: application/vnd.github+json" \
 *     https://api.github.com/repos/WHZze/DailyBrief/actions/workflows/daily.yml/dispatches \
 *     -d '{"ref":"main"}'
 *
 * No-op if TRIGGER_REMOTE_TOKEN is not configured (skip in env without token).
 */

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// Constants — hardcoded for the WHZze/DailyBrief fork.
const REPO = "WHZze/DailyBrief";
const WORKFLOW_FILE = "daily.yml";
const TOKEN = process.env.TRIGGER_REMOTE_TOKEN || "";

if (!TOKEN) {
  console.log("[trigger-remote] TRIGGER_REMOTE_TOKEN not set — skipping");
  process.exit(0);
}

const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

try {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (resp.status === 204) {
    console.log("[trigger-remote] workflow_dispatch triggered OK");
  } else {
    const body = await resp.text();
    console.warn(`[trigger-remote] trigger failed (HTTP ${resp.status}): ${body.slice(0, 200)}`);
  }
} catch (err) {
  console.warn(`[trigger-remote] trigger failed (fetch error): ${err.message}`);
}
