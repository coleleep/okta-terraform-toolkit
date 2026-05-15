import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import { IncomingMessage } from 'http';
import AdmZip from 'adm-zip';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'provider-settings.json');
}

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'okta-provider-versions');
}

function mirrorDir(): string {
  return path.join(app.getPath('userData'), 'terraform-mirror');
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

export function getSelectedVersion(): string {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    const s = JSON.parse(raw);
    return typeof s.selectedProviderVersion === 'string' ? s.selectedProviderVersion : 'system';
  } catch {
    return 'system';
  }
}

export function setSelectedVersion(version: string): void {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { /* new file */ }
  existing.selectedProviderVersion = version;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(existing, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

export function getMirrorOsArch(): string | null {
  const { platform, arch } = process;
  if (platform === 'darwin' && arch === 'arm64') return 'darwin_arm64';
  if (platform === 'darwin' && arch === 'x64')   return 'darwin_amd64';
  if (platform === 'linux'  && arch === 'x64')   return 'linux_amd64';
  if (platform === 'win32'  && arch === 'x64')   return 'windows_amd64';
  return null;
}

export function getPlatformAssetName(version: string): string | null {
  const osArch = getMirrorOsArch();
  if (!osArch) return null;
  return `terraform-provider-okta_${version}_${osArch}.zip`;
}

export function getBinaryFilename(version: string): string {
  return process.platform === 'win32'
    ? `terraform-provider-okta_v${version}_x5.exe`
    : `terraform-provider-okta_v${version}_x5`;
}

// ---------------------------------------------------------------------------
// Cache paths
// ---------------------------------------------------------------------------

export function getProviderCacheDir(version: string): string {
  return path.join(cacheDir(), version);
}

export function isVersionCached(version: string): boolean {
  return fs.existsSync(path.join(getProviderCacheDir(version), getBinaryFilename(version)));
}

// ---------------------------------------------------------------------------
// Mirror layout
// ---------------------------------------------------------------------------

export function getMirrorBinaryPath(version: string): string {
  const osArch = getMirrorOsArch() ?? 'darwin_arm64';
  return path.join(
    mirrorDir(),
    'registry.terraform.io', 'okta', 'okta',
    version, osArch,
    getBinaryFilename(version),
  );
}

export function getCliConfigPath(): string {
  return path.join(mirrorDir(), '.terraformrc');
}

export function writeCliConfig(): void {
  const mDir = mirrorDir();
  fs.mkdirSync(mDir, { recursive: true });
  // Use forward slashes even on Windows — Terraform HCL requires them
  const normalised = mDir.replace(/\\/g, '/');
  const content = `provider_installation {
  filesystem_mirror {
    path    = "${normalised}"
    include = ["registry.terraform.io/okta/okta"]
  }
  "direct" {
    exclude = ["registry.terraform.io/okta/okta"]
  }
}
`;
  fs.writeFileSync(getCliConfigPath(), content, 'utf8');
}

export function ensureMirrorLayout(version: string): void {
  const dest = getMirrorBinaryPath(version);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const src = path.join(getProviderCacheDir(version), getBinaryFilename(version));
    fs.copyFileSync(src, dest);
    if (process.platform !== 'win32') fs.chmodSync(dest, '0755');
  }
  writeCliConfig();
}

// ---------------------------------------------------------------------------
// GitHub release listing
// ---------------------------------------------------------------------------

interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  assets: { name: string }[];
}

export async function listGitHubVersions(): Promise<{ version: string; cached: boolean }[]> {
  const releases = await httpsGetJson<GitHubRelease[]>(
    'https://api.github.com/repos/okta/terraform-provider-okta/releases?per_page=50',
  );
  return releases
    .filter((r) => !r.prerelease && !r.draft && r.assets.some((a) => a.name === 'SHA256SUMS.sig'))
    .map((r) => {
      const version = r.tag_name.replace(/^v/, '');
      return { version, cached: isVersionCached(version) };
    });
}

// ---------------------------------------------------------------------------
// Download + extract
// ---------------------------------------------------------------------------

export async function downloadAndExtract(
  version: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  const assetName = getPlatformAssetName(version);
  if (!assetName) {
    throw new Error(`No binary available for platform ${process.platform}/${process.arch}`);
  }

  const url = `https://github.com/okta/terraform-provider-okta/releases/download/v${version}/${assetName}`;
  const destDir = getProviderCacheDir(version);
  fs.mkdirSync(destDir, { recursive: true });

  const zipPath = path.join(os.tmpdir(), `okta-provider-${version}-${Date.now()}.zip`);
  await downloadFile(url, zipPath, onProgress);

  try {
    const zip = new AdmZip(zipPath);
    const binaryName = getBinaryFilename(version);
    const entry = zip.getEntries().find((e) => !e.isDirectory && path.basename(e.entryName) === binaryName);
    if (!entry) throw new Error(`Binary ${binaryName} not found in downloaded ZIP`);

    const destPath = path.join(destDir, binaryName);
    fs.writeFileSync(destPath, entry.getData());

    const size = fs.statSync(destPath).size;
    if (size === 0) {
      fs.unlinkSync(destPath);
      throw new Error(`Extracted binary for ${version} is empty`);
    }

    if (process.platform !== 'win32') fs.chmodSync(destPath, '0755');
  } finally {
    try { fs.unlinkSync(zipPath); } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpsGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'okta-terraform-toolkit', Accept: 'application/vnd.github+json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { try { resolve(JSON.parse(data) as T); } catch (e) { reject(e); } });
        res.on('error', reject);
      },
    ).on('error', reject);
  });
}

function downloadFile(url: string, dest: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, depth = 0) => {
      if (depth > 5) { reject(new Error('Too many redirects')); return; }
      const lib: typeof https = u.startsWith('https') ? https : (http as unknown as typeof https);
      lib.get(u, { headers: { 'User-Agent': 'okta-terraform-toolkit' } } as Parameters<typeof https.get>[1], (res: IncomingMessage) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          follow(res.headers.location, depth + 1);
          return;
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          received += chunk.length;
          if (total > 0) onProgress(Math.floor((received / total) * 100));
        });
        res.on('end', () => { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(); });
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}
