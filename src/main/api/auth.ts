import axios, { AxiosInstance } from 'axios';
import { ConnectionConfig } from '../../shared/types';

let httpClient: AxiosInstance | null = null;
let currentConfig: ConnectionConfig | null = null;

export async function connect(config: ConnectionConfig): Promise<void> {
  currentConfig = config;

  const cleanToken = config.token.trim().replace(/^SSWS\s+/i, '');
  httpClient = axios.create({
    baseURL: config.orgUrl,
    headers: {
      Authorization: `SSWS ${cleanToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  // Test the connection
  await httpClient.get('/api/v1/org');
}

export function getClient(): AxiosInstance {
  if (!httpClient || !currentConfig) {
    throw new Error('Not connected. Call connect() first.');
  }
  return httpClient;
}

export function disconnect(): void {
  httpClient = null;
  currentConfig = null;
}

export function isConnected(): boolean {
  return httpClient !== null && currentConfig !== null;
}

export function getConfig(): ConnectionConfig | null {
  return currentConfig;
}

export function getGrantedScopes(): string[] {
  return []; // API token auth — no OAuth scopes
}
