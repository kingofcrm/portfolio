/**
 * delivery.js — Slack/Discord webhook and email delivery
 */

import https from 'https';
import nodemailer from 'nodemailer';

function postWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(webhookUrl);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function deliverSlack(summary, classification, config, timestamp) {
  const webhookUrl = config.delivery.webhook_url || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('No Slack webhook URL configured. Set SLACK_WEBHOOK_URL in .env or delivery.webhook_url in config.json.');

  const { gainers, losers } = classification;
  const topMovers = [
    ...gainers.slice(0, 3).map((s) => `${s.ticker} +${s.changePct}%`),
    ...losers.slice(0, 3).map((s) => `${s.ticker} ${s.changePct}%`),
  ].join(' | ');

  const payload = {
    text: `*Stock Market Summary — ${timestamp}*`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: summary },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Top Movers*\n${topMovers || 'No significant movers'}` },
      },
    ],
  };

  await postWebhook(webhookUrl, payload);
}

async function deliverEmail(summary, classification, config, timestamp) {
  const { smtp_host, smtp_port, from, to } = config.delivery.email;

  const transporter = nodemailer.createTransport({
    host: smtp_host,
    port: smtp_port ?? 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const { gainers, losers, marketMood } = classification;
  const allStocks = [...gainers, ...losers].sort((a, b) => b.changePct - a.changePct);

  const rows = allStocks
    .map((s) => {
      const color = s.changePct >= 0 ? '#16a34a' : '#dc2626';
      const sign = s.changePct > 0 ? '+' : '';
      return `<tr>
        <td style="padding:6px 12px;font-weight:bold">${s.ticker}</td>
        <td style="padding:6px 12px">${s.name}</td>
        <td style="padding:6px 12px">$${s.price}</td>
        <td style="padding:6px 12px;color:${color};font-weight:bold">${sign}${s.changePct}%</td>
        <td style="padding:6px 12px">${s.trendLabel}</td>
        <td style="padding:6px 12px">${s.volumeSpike ? `Yes (${s.volumeRatio}x)` : '-'}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:800px;margin:auto;padding:20px">
  <h2 style="border-bottom:2px solid #e5e7eb;padding-bottom:8px">
    Market Summary — ${timestamp}
  </h2>
  <div style="background:#f9fafb;padding:16px;border-radius:8px;margin-bottom:20px;white-space:pre-line">
    ${summary}
  </div>
  <h3>All Watchlist Stocks</h3>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:8px 12px;text-align:left">Ticker</th>
        <th style="padding:8px 12px;text-align:left">Name</th>
        <th style="padding:8px 12px;text-align:left">Price</th>
        <th style="padding:8px 12px;text-align:left">Change</th>
        <th style="padding:8px 12px;text-align:left">Trend</th>
        <th style="padding:8px 12px;text-align:left">Vol. Spike</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;

  const recipients = Array.isArray(to) ? to.join(',') : to;
  await transporter.sendMail({
    from,
    to: recipients,
    subject: `Market Summary — ${timestamp} | Mood: ${marketMood}`,
    html,
  });
}

export async function deliver(summary, classification, config, timestamp) {
  const method = config.delivery.method;

  if (method === 'slack' || method === 'discord') {
    await deliverSlack(summary, classification, config, timestamp);
  } else if (method === 'email') {
    await deliverEmail(summary, classification, config, timestamp);
  } else {
    throw new Error(`Unknown delivery method: "${method}". Use "slack", "discord", or "email".`);
  }
}
