/**
 * fetcher.js — Yahoo Finance quote fetcher
 * Fetches 5-day OHLCV data for each ticker using Promise.all for parallelism.
 * Retries up to 3 times with exponential backoff on failure.
 */

import https from 'https';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TIMEOUT_MS = 12000;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StockAgent/1.0)',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function fetchQuote(ticker, retries = 3) {
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=7d`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await httpsGet(url);
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error('Empty chart result');

      const meta = result.meta;
      const quoteData = result.indicators?.quote?.[0] ?? {};
      const closes = (quoteData.close ?? []).filter((v) => v != null && isFinite(v));
      const volumes = (quoteData.volume ?? []).filter((v) => v != null && isFinite(v));

      const price = meta.regularMarketPrice ?? meta.currentPrice;
      const previousClose = meta.previousClose ?? meta.chartPreviousClose;

      if (!price || !previousClose) throw new Error('Missing price data');

      return {
        ticker,
        name: meta.shortName || meta.longName || ticker,
        price,
        previousClose,
        dayHigh: meta.regularMarketDayHigh ?? price,
        dayLow: meta.regularMarketDayLow ?? price,
        volume: meta.regularMarketVolume ?? 0,
        closes,
        volumes,
        error: null,
      };
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      } else {
        return { ticker, error: `${err.message} (after ${retries} attempts)` };
      }
    }
  }
}

export async function fetchAllQuotes(watchlist) {
  return Promise.all(watchlist.map((ticker) => fetchQuote(ticker)));
}
