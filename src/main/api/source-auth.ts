import axios, { AxiosInstance } from 'axios';
import { join } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { app } from 'electron';
import { ConnectionConfig, SourceConnectionStatus, IpcResponse } from '../../shared/types';

const CONFIG_FILE = 'source-org-config.json';

let sourceClient: AxiosInstance | null = null;
let sourceConfig: ConnectionConfig | null = null;
let _userDataOverride: string | null = null;

// For testing only
export function _setUserDataPathForTesting(path: string): void {
  _userDataOverride = path;
  sourceClient = null;
  sourceConfig = null;
}

function getUserDataPath(): string {
  return _userDataOverride ?? app.getPath('userData');
}

function saveConfig(config: ConnectionConfig): void {
  try {
    writeFileSync(
      join(getUserDataPath(), CONFIG_FILE),
      JSON.stringify({ orgUrl: config.orgUrl, token: config.token }),
      'utf-8',
    );
  } catch {
    // non-critical
  }
}

export function loadSourceConfig(): ConnectionConfig | null {
  try {
    const configPath = join(getUserDataPath(), CONFIG_FILE);
    if (!existsSync(configPath)) return null;
    const { orgUrl, token } = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (orgUrl && token) {
      return { orgUrl, authMethod: 'token', token };
    }
  } catch {
    // ignore
  }
  return null;
}

export async function connectSource(
  config: ConnectionConfig,
): Promise<IpcResponse<SourceConnectionStatus>> {
  try {
    const cleanToken = config.token.trim().replace(/^SSWS\s+/i, '');
    const client = axios.create({
      baseURL: config.orgUrl,
      headers: {
        Authorization: `SSWS ${cleanToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    await client.get('/api/v1/org');

    sourceClient = client;
    sourceConfig = config;
    saveConfig(config);

    return {
      success: true,
      data: { connected: true, orgUrl: config.orgUrl },
    };
  } catch (err: unknown) {
    sourceClient = null;
    sourceConfig = null;
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: { connected: false, error: message } };
  }
}

export function disconnectSource(): void {
  sourceClient = null;
  sourceConfig = null;
}

export function isSourceConnected(): boolean {
  return sourceClient !== null && sourceConfig !== null;
}

export function getSourceClient(): AxiosInstance | null {
  return sourceClient;
}

export function getSourceConfig(): ConnectionConfig | null {
  return sourceConfig;
}

export function getSourceStatus(): SourceConnectionStatus {
  return {
    connected: isSourceConnected(),
    orgUrl: sourceConfig?.orgUrl,
  };
}
