import { app } from 'electron';
import { join } from 'path';
import {
  appendFileSync,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { LogLevel } from '../shared/types';

const LOG_FILE = 'otto-audit.log';
const CONFIG_FILE = 'log-config.json';
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 3;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = 'info';
let _userDataOverride: string | null = null;

// For testing only — call before any log operations
export function _setUserDataPathForTesting(path: string): void {
  _userDataOverride = path;
  currentLevel = 'info';
}

function getUserDataPath(): string {
  return _userDataOverride ?? app.getPath('userData');
}

function getLogPath(): string {
  return join(getUserDataPath(), LOG_FILE);
}

function rotateIfNeeded(): void {
  const logPath = getLogPath();
  if (!existsSync(logPath)) return;
  if (statSync(logPath).size < MAX_SIZE_BYTES) return;

  const userData = getUserDataPath();
  // Rotate: .log.3 ← .log.2 ← .log.1 ← .log
  for (let i = MAX_FILES; i >= 1; i--) {
    const dest = join(userData, `${LOG_FILE}.${i}`);
    const src = i === 1 ? logPath : join(userData, `${LOG_FILE}.${i - 1}`);
    if (existsSync(src)) {
      if (existsSync(dest)) unlinkSync(dest);
      renameSync(src, dest);
    }
  }
}

function writeEntry(level: LogLevel, subsystem: string, message: string, data?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const dataStr = data !== undefined ? `  ${JSON.stringify(data)}` : '';
  console.log(`[${subsystem}] ${level.toUpperCase()} ${message}${dataStr}`);

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    subsystem,
    message,
  };
  if (data !== undefined) entry.data = data;

  try {
    rotateIfNeeded();
    appendFileSync(getLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Never crash on log write failure
  }
}

export const logger = {
  debug: (subsystem: string, message: string, data?: unknown) =>
    writeEntry('debug', subsystem, message, data),
  info: (subsystem: string, message: string, data?: unknown) =>
    writeEntry('info', subsystem, message, data),
  warn: (subsystem: string, message: string, data?: unknown) =>
    writeEntry('warn', subsystem, message, data),
  error: (subsystem: string, message: string, data?: unknown) =>
    writeEntry('error', subsystem, message, data),
};

export function setLevel(level: LogLevel): void {
  currentLevel = level;
  try {
    writeFileSync(
      join(getUserDataPath(), CONFIG_FILE),
      JSON.stringify({ level }),
      'utf-8',
    );
  } catch {
    // ignore
  }
}

export function getLevel(): LogLevel {
  return currentLevel;
}

export function loadLevel(): void {
  try {
    const configPath = join(getUserDataPath(), CONFIG_FILE);
    if (!existsSync(configPath)) return;
    const { level } = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (level && LEVEL_ORDER[level as LogLevel] !== undefined) {
      currentLevel = level as LogLevel;
    }
  } catch {
    // Use default 'info'
  }
}
