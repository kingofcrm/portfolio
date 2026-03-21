/**
 * storage.js — JSON persistence and logging
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, 'history.json');
const LOG_FILE = path.join(__dirname, 'agent.log');

// Retain at most 48 snapshots (~24h at 30-min intervals)
const MAX_SNAPSHOTS = 48;

export function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function appendToHistory(metrics, timestamp) {
  const history = loadHistory();
  history.push({ timestamp, metrics });
  const trimmed = history.slice(-MAX_SNAPSHOTS);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}

export function log(message, level = 'INFO') {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  console.log(line);
}

export function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}
