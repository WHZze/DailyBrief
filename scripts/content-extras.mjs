/**
 * Fetch extra content for the daily push notification.
 *
 * Sources (all free, no API key needed):
 *   - Weather: Open-Meteo (open-meteo.com)
 *   - Daily quote: Hitokoto (v1.hitokoto.cn)
 *   - Today in history: Wikipedia REST API
 *
 * All fetches are best-effort — failures are non-fatal and the notification
 * degrades gracefully to just the report summary.
 */

const CITY = {
  name: process.env.WEATHER_CITY || "北京",
  lat: parseFloat(process.env.WEATHER_LAT) || 39.9042,
  lon: parseFloat(process.env.WEATHER_LON) || 116.4074,
};

const WEATHER_EMOJI = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌦️", 61: "🌧️", 63: "🌧️",
  65: "🌧️", 71: "❄️", 73: "❄️", 75: "❄️", 77: "❄️",
  80: "🌦️", 81: "🌦️", 82: "🌦️", 85: "🌨️", 86: "🌨️",
  95: "⛈️", 96: "⛈️", 99: "⛈️",
};

// ── Weather (Open-Meteo) ───────────────────────────────────────────────────
export async function fetchWeather() {
  try {
    const url = [
      "https://api.open-meteo.com/v1/forecast",
      `?latitude=${CITY.lat}&longitude=${CITY.lon}`,
      "&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max",
      "&timezone=Asia/Shanghai&forecast_days=2",
    ].join("");
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json();
    const dates = d.daily.time;
    const tmax = d.daily.temperature_2m_max;
    const tmin = d.daily.temperature_2m_min;
    const codes = d.daily.weathercode;
    const precip = d.daily.precipitation_probability_max;
    const lines = [];
    for (let i = 0; i < Math.min(2, dates.length); i++) {
      const emoji = WEATHER_EMOJI[codes[i]] || "🌡️";
      const label = i === 0 ? "今天" : "明天";
      lines.push(`${label} ${emoji} ${tmin[i]}~${tmax[i]}°C  降水 ${precip[i]}%`);
    }
    return `☀️ ${CITY.name}天气\n${lines.join("\n")}`;
  } catch (e) {
    console.warn(`[extras] weather fetch failed: ${e.message}`);
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
    const lines = events.map(
      (e) => `· ${e.year}年 ${e.text}`
    );
    return `📅 历史上的今天\n${lines.join("\n")}`;
  } catch (e) {
    console.warn(`[extras] history fetch failed: ${e.message}`);
    return "";
  }
}

// ── Aggregate extras ────────────────────────────────────────────────────────
export async function getExtras() {
  const [weather, quote, history] = await Promise.all([
    fetchWeather(),
    fetchQuote(),
    fetchHistory(),
  ]);
  return [weather, quote, history].filter(Boolean).join("\n\n");
}
