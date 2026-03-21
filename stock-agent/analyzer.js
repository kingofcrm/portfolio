/**
 * analyzer.js — Metric computation and trend detection
 * Computes change %, linear trend slope, volume spikes, and market mood.
 */

/** Ordinary least-squares slope of a value array (index = x, value = y). */
function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;

  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((acc, v, i) => acc + i * v, 0);
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function computeMetrics(quotes, config) {
  const threshold = config.alert_threshold_pct;

  return quotes.map((q) => {
    if (q.error) {
      return { ticker: q.ticker, hasError: true, error: q.error };
    }

    const changePct = round2(((q.price - q.previousClose) / q.previousClose) * 100);

    // Trend: slope of close prices normalised by average price
    const closes = q.closes.slice(-config.trend_window_periods);
    const slope = linearSlope(closes);
    const avgPrice = closes.length > 0
      ? closes.reduce((a, b) => a + b, 0) / closes.length
      : q.price;
    const slopePct = avgPrice > 0 ? (slope / avgPrice) * 100 : 0;

    let trendLabel;
    if (slopePct > 0.5) trendLabel = 'bullish';
    else if (slopePct < -0.5) trendLabel = 'bearish';
    else trendLabel = 'sideways';

    // Volume spike: today's volume vs average of prior days
    const priorVolumes = q.volumes.slice(0, -1).filter((v) => v > 0);
    const avgVolume = priorVolumes.length > 0
      ? priorVolumes.reduce((a, b) => a + b, 0) / priorVolumes.length
      : 0;
    const volumeSpike = avgVolume > 0 && q.volume > 1.5 * avgVolume;
    const volumeRatio = avgVolume > 0 ? round2(q.volume / avgVolume) : null;

    const isAlert = Math.abs(changePct) >= threshold;

    return {
      ticker: q.ticker,
      name: q.name,
      price: round2(q.price),
      previousClose: round2(q.previousClose),
      dayHigh: round2(q.dayHigh),
      dayLow: round2(q.dayLow),
      volume: q.volume,
      changePct,
      trendLabel,
      isAlert,
      volumeSpike,
      volumeRatio,
      hasError: false,
    };
  });
}

export function classifyMarket(metrics) {
  const valid = metrics.filter((m) => !m.hasError);

  const gainers = valid.filter((m) => m.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct);
  const losers = valid.filter((m) => m.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct);
  const alerts = valid.filter((m) => m.isAlert);
  const flat = valid.filter((m) => Math.abs(m.changePct) < 0.25);

  const total = valid.length;
  let marketMood = 'mixed';
  if (total > 0) {
    if (gainers.length / total > 0.7) marketMood = 'bullish';
    else if (losers.length / total > 0.7) marketMood = 'bearish';
  }

  return { gainers, losers, alerts, flat, marketMood, total };
}
