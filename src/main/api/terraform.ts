import { spawn, ChildProcess } from 'child_process';

let activeProcess: ChildProcess | null = null;

export function runTerraform(
  dir: string,
  args: string[],
  onLine: (line: string) => void,
  env?: Record<string, string>
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('terraform', args, { cwd: dir, env: { ...process.env, ...env } });
    activeProcess = proc;

    const processData = (data: Buffer | string) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };

    proc.stdout.on('data', processData);
    proc.stderr.on('data', processData);

    proc.on('error', (err) => {
      activeProcess = null;
      reject(err);
    });

    proc.on('close', (code) => {
      activeProcess = null;
      resolve({ exitCode: code ?? 1 });
    });
  });
}

export function cancelTerraform(): void {
  if (activeProcess) {
    activeProcess.kill('SIGTERM');
    activeProcess = null;
  }
}
