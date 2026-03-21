/**
 * index.js — Stock Market Monitor Agent entry point
 *
 * Scheduler loop:
 *  - Every 30 min during market hours (Mon–Fri 9:30–16:00 ET)
 *  - Every 2 hours after hours / weekends
 *  - End-of-day summary at 16:30 ET via cron
 *
 * Alert deduplication: same ticker won't re-alert within 2 hours.
 */

import 'dotenv/config';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

import { fetchAllQuotes } from './fetcher.js';
import { computeMetrics, classifyMarket } from './analyzer.js';
import { generateSummary } from './summarizer.js';
import { deliver } from './delivery.js';
import { appendToHistory, log, loadConfig } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(path.join(__dirname, 'config.json'));

// Alert deduplication — keyed by ticker, value is timestamp of last alert
const lastAlertTime = new Map();
const ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Market Hours ────────────────────────────────────────────────────────────

function getETComponents(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

function isMarketHours(date = new Date()) {
  const { weekday, hour, minute } = getETComponents(date);
  if (['Sat', 'Sun'].includes(weekday)) return false;
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
}

function nowET() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// ─── Alert Deduplication ─────────────────────────────────────────────────────

function filterDuplicateAlerts(classification) {
  const now = Date.now();
  const dedupedAlerts = classification.alerts.filter((stock) => {
    const last = lastAlertTime.get(stock.ticker);
    if (last && now - last < ALERT_COOLDOWN_MS) return false;
    lastAlertTime.set(stock.ticker, now);
    return true;
  });
  return { ...classification, alerts: dedupedAlerts };
}

// ─── Core Cycle ──────────────────────────────────────────────────────────────

async function runCycle(label = 'scheduled') {
  const timestamp = nowET();
  log(`Cycle start [${label}] | tickers=${config.watchlist.length}`);

  try {
    // Step 1: Fetch quotes (parallel)
    const quotes = await fetchAllQuotes(config.watchlist);
    const errorCount = quotes.filter((q) => q.error).length;
    if (errorCount > 0) {
      quotes.filter((q) => q.error).forEach((q) =>
        log(`Fetch error — ${q.ticker}: ${q.error}`, 'WARN')
      );
    }

    // Step 2: Compute metrics
    const metrics = computeMetrics(quotes, config);

    // Step 3: Classify market mood
    const classification = classifyMarket(metrics);

    // Step 4: Deduplicate alerts
    const filteredClassification = filterDuplicateAlerts(classification);

    // Step 5: Persist snapshot
    appendToHistory(metrics, timestamp);

    // Step 6: Generate LLM summary (one call for all tickers)
    const summary = await generateSummary(filteredClassification, config, timestamp);

    // Step 7: Deliver
    await deliver(summary, filteredClassification, config, timestamp);

    log(
      `Cycle done [${label}] | ok=${config.watchlist.length - errorCount} err=${errorCount} ` +
        `alerts=${filteredClassification.alerts.length} mood=${filteredClassification.marketMood}`
    );
  } catch (err) {
    log(`Cycle failed [${label}]: ${err.message}`, 'ERROR');
    console.error(err);
  }
}

// ─── Adaptive Scheduler ──────────────────────────────────────────────────────

function scheduleNextRun() {
  const inMarket = isMarketHours();
  const intervalMinutes = inMarket
    ? config.schedule.market_hours_interval_minutes
    : config.schedule.after_hours_interval_minutes;

  log(
    `Next run in ${intervalMinutes} min (market hours: ${inMarket})`
  );

  return setTimeout(async () => {
    await runCycle();
    scheduleNextRun();
  }, intervalMinutes * 60 * 1000);
}

// ─── End-of-Day Cron ─────────────────────────────────────────────────────────

const [eodHour, eodMin] = config.schedule.end_of_day_summary
  .split(':')
  .map(Number);

cron.schedule(
  `${eodMin} ${eodHour} * * 1-5`,
  () => runCycle('end-of-day'),
  { timezone: 'America/New_York' }
);

// ─── Startup ─────────────────────────────────────────────────────────────────

log('Stock Market Monitor Agent starting...');
log(`Watchlist: ${config.watchlist.join(', ')}`);
log(`Delivery: ${config.delivery.method}`);

// Run immediately, then begin adaptive scheduling
runCycle('startup').then(() => scheduleNextRun());
