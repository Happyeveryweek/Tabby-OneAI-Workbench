import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { commandFor, runtimeProject } from './commands';
import { json } from './codex-data';

interface Request { method: string; params?: object; }

// The installed Codex handles authentication and all protocol I/O. Its stdout is never logged.
export async function codexRead<T>(directory: string, distro: string | undefined, requests: Request[]): Promise<(T | undefined)[]> {
    const plan = commandFor(runtimeProject(distro), { executable: 'codex', codexHome: directory, args: ['app-server', '--listen', 'stdio://'] });
    const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const promises = new Map<number, (result: any) => void>();
    let next = 0;
    let closed = false;
    const finish = () => {
        closed = true;
        for (const resolve of promises.values()) resolve(undefined);
        promises.clear();
    };
    const timeout = setTimeout(finish, 8000);
    child.on('error', finish);
    child.on('close', finish);
    child.stdin.on('error', finish);
    child.stdout.on('error', finish);
    lines.on('error', finish);
    lines.on('line', line => {
        const reply = json(line);
        if (typeof reply?.id !== 'number' || !('result' in reply || 'error' in reply)) return;
        const resolve = promises.get(reply.id);
        promises.delete(reply.id);
        resolve?.(reply.result);
    });
    const call = (request: Request) => new Promise<any>(resolve => {
        if (closed) return resolve(undefined);
        const id = ++next;
        promises.set(id, resolve);
        child.stdin.write(JSON.stringify({ id, ...request }) + '\n');
    });
    try {
        const ready = await call({ method: 'initialize', params: { clientInfo: { name: 'tabby-oneai', title: 'Tabby OneAI', version: require('../package.json').version }, capabilities: null } });
        if (!ready || closed) return requests.map(() => undefined);
        child.stdin.write('{"method":"initialized"}\n');
        return await Promise.all(requests.map(call));
    } finally {
        clearTimeout(timeout);
        lines.close();
        child.stdin.end();
        const kill = setTimeout(() => child.kill(), 1200);
        child.once('close', () => clearTimeout(kill));
    }
}
