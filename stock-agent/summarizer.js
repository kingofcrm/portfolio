/**
 * summarizer.js — Claude-powered market summary generation
 * Batches all tickers into a single prompt (never one call per ticker).
 * Uses streaming to avoid HTTP timeouts on longer generations.
 */

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a concise financial market analyst. Write clear, factual, jargon-free \
summaries of stock market data. Use plain English. Never give investment advice. \
Always end with a one-line market mood statement.`;

export async function generateSummary(classification, config, timestamp) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { gainers, losers, alerts, marketMood } = classification;
  const threshold = config.alert_threshold_pct;

  const fmt = (s) => {
    const sign = s.changePct > 0 ? '+' : '';
    return `- ${s.ticker} (${s.name}): $${s.price} | ${sign}${s.changePct}% | Trend: ${s.trendLabel}`;
  };

  const fmtAlert = (s) => {
    const sign = s.changePct > 0 ? '+' : '';
    const volNote = s.volumeSpike ? `YES (${s.volumeRatio}x avg)` : 'no';
    return `- ${s.ticker}: ${sign}${s.changePct}% move | Volume spike: ${volNote}`;
  };

  const gainersSection = gainers.slice(0, 5).map(fmt).join('\n') || 'None';
  const losersSection = losers.slice(0, 5).map(fmt).join('\n') || 'None';
  const alertsSection = alerts.map(fmtAlert).join('\n') || 'None';

  const userPrompt = `Here is the current market snapshot as of ${timestamp}:

Market mood: ${marketMood}

Top gainers:
${gainersSection}

Top losers:
${losersSection}

Alerts (moved >${threshold}%):
${alertsSection}

Write a 3–5 sentence market summary followed by bullet-point highlights. \
Flag any volume spikes or unusual activity. End with overall market mood.`;

  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const message = await stream.finalMessage();
  return message.content.find((b) => b.type === 'text')?.text ?? '';
}
