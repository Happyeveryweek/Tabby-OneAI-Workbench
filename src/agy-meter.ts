import { unwatchFile, watchFile } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { agyRuntimePaths, cliSessionHomes, detect, localReadPath, supportsAgyStatusSettings } from './commands';
import type { Command, Project } from './commands';
import type { AgyStatus } from './agy-status';

interface AgyMeter {
    command: Command;
    resultFile: string;
    subscribe(receive: (status: AgyStatus) => void): () => void;
    dispose(): void;
}

const meterRoot = join(tmpdir(), 'tabby-oneai-meters');
const safeId = (taskId: string) => taskId.replace(/[^a-zA-Z0-9._-]/g, '_');

export function watchAgyMeterFile(resultFile: string, receive: (status: AgyStatus) => void): () => void {
    let disposed = false;
    let last = '';
    const read = () => {
        void readFile(resultFile, 'utf8').then(text => {
            if (!disposed && text !== last) {
                last = text;
                receive(JSON.parse(text) as AgyStatus);
            }
        }).catch(() => undefined);
    };
    watchFile(resultFile, { interval: 500, persistent: false }, read);
    read();
    return () => { disposed = true; unwatchFile(resultFile, read); };
}

function extractSettingsCommand(options: { command?: string; args?: string[] } | undefined): string | undefined {
    const args = Array.isArray(options?.args) ? options!.args : [];
    if (!args.length) return;
    const sources = [...args];
    const encodedIdx = args.findIndex(item => item.toLowerCase() === '-encodedcommand');
    if (encodedIdx >= 0 && typeof args[encodedIdx + 1] === 'string') {
        try { sources.push(Buffer.from(args[encodedIdx + 1], 'base64').toString('utf16le')); } catch {}
    }
    const idx = args.indexOf('--settings');
    if (idx >= 0 && typeof args[idx + 1] === 'string') {
        try {
            const parsed = JSON.parse(args[idx + 1]);
            if (typeof parsed?.statusLine?.command === 'string') return parsed.statusLine.command;
        } catch {}
    }
    for (const chunk of sources) {
        const match = chunk.match(/(['"])(\{"statusLine":[\s\S]*?\})\1/);
        const rawJson = match?.[2] ?? chunk.match(/(\{"statusLine":\{"type":"command",[\s\S]*?\}\})/)?.[1];
        if (!rawJson) continue;
        try {
            const parsed = JSON.parse(rawJson.replace(/''/g, "'"));
            if (typeof parsed?.statusLine?.command === 'string') return parsed.statusLine.command;
        } catch {}
    }
    return sources.join(' ');
}

export async function recoverAgyMeter(
    options: { command?: string; args?: string[] } | undefined,
    project?: Project,
): Promise<{ resultFile: string } | undefined> {
    const commandText = extractSettingsCommand(options);
    if (!commandText) return;
    if (!commandText.includes('agy-status-bridge') && !commandText.includes('statusline.cmd')) return;

    const cmdMatch = commandText.match(/([a-zA-Z]:[\\/][^\s"']+?[\\/]tabby-oneai-(?:agy-[^\\/\s"']+|meters[\\/][^\\/\s"']+)[\\/]statusline\.cmd)/i);
    if (cmdMatch) {
        const cmdFile = cmdMatch[1].replace(/\//g, '\\');
        const dir = win32.dirname(cmdFile);
        const resultFile = win32.join(dir, 'status.json');
        if (!await stat(cmdFile).catch(() => null)) {
            await mkdir(dir, { recursive: true }).catch(() => undefined);
            const helper = join(__dirname, 'agy-status-bridge.js');
            await writeFile(cmdFile, `@echo off\r\nsetlocal DisableDelayedExpansion\r\nnode "${helper}" "${resultFile}"\r\n`, 'utf8').catch(() => undefined);
        }
        return { resultFile };
    }

    const destMatch = commandText.match(/agy-status-bridge\.js['"\s]+(?:'([^']+)'|"([^"]+)"|([^\s"']+))/);
    const rawDest = destMatch?.[1] ?? destMatch?.[2] ?? destMatch?.[3];
    if (!rawDest || (!rawDest.includes('tabby-oneai-agy-') && !rawDest.includes('tabby-oneai-meters'))) return;
    const resultFile = project?.distro && posix.isAbsolute(rawDest)
        ? await localReadPath(rawDest, project.distro)
        : rawDest;
    await mkdir(win32.dirname(resultFile), { recursive: true }).catch(() => undefined);
    return { resultFile };
}

export async function prepareAgyMeter(project: Project, task: Command, source: 'agy' | 'claude' = 'agy', taskId?: string): Promise<AgyMeter | undefined> {
    if (task.args.some(arg => /^--settings(?:=|$)/.test(arg) || (source === 'claude' && /^--setting-sources(?:=|$)/.test(arg)))) return;
    const [supported, hasNode] = await Promise.all([supportsAgyStatusSettings(project, task.executable), detect(project, 'node')]);
    if (!supported || !hasNode) return;
    const persistent = Boolean(taskId);
    const directory = taskId ? join(meterRoot, safeId(taskId)) : await mkdtemp(join(tmpdir(), 'tabby-oneai-agy-'));
    if (taskId) await mkdir(directory, { recursive: true });
    const dispose = () => {
        if (!persistent) void rm(directory, { recursive: true, force: true }).catch(() => undefined);
    };
    try {
        const resultFile = join(directory, 'status.json');
        await rm(resultFile, { force: true }).catch(() => undefined);
        const runtime = await agyRuntimePaths(project, [join(__dirname, 'agy-status-bridge.js'), resultFile]);
        const [helper, destination] = runtime.native;
        let settings = [runtime.settings];
        if (source === 'claude') {
            const path = project.distro ? posix : win32;
            const home = task.env?.CLAUDE_CONFIG_DIR ?? (await cliSessionHomes(project.distro)).claude;
            settings = await Promise.all([
                path.join(home, 'settings.json'), path.join(project.directory, '.claude', 'settings.json'),
                path.join(project.directory, '.claude', 'settings.local.json'),
            ].map(file => localReadPath(file, project.distro)));
        }
        let statusLine;
        for (const [index, file] of settings.entries()) {
            try {
                const data = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
                if (data.statusLine === undefined) continue;
                if (index > 0) { dispose(); return; }
                statusLine = data.statusLine;
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        if (statusLine?.enabled === false) { dispose(); return; }
        const previous = statusLine?.type === 'command' && typeof statusLine?.command === 'string' && statusLine.command.trim();
        let commandString: string;
        if (!project.distro && source === 'agy') {
            const launcher = join(directory, 'statusline.cmd');
            const cmdArgs = ['node', `"${helper}"`, `"${destination}"`];
            if (previous) cmdArgs.push(Buffer.from(previous).toString('base64'));
            await writeFile(launcher, `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${cmdArgs.join(' ')}\r\n`, 'utf8');
            commandString = launcher.replace(/\\/g, '/');
        } else {
            const quote = (s: string) => project.distro ? "'" + s.replace(/'/g, "'\\''") + "'" : '"' + s + '"';
            const args = ['node', quote(helper), quote(destination)];
            if (source === 'claude') args.push(previous ? Buffer.from(previous).toString('base64') : '-', source);
            else if (previous) args.push(Buffer.from(previous).toString('base64'));
            commandString = args.join(' ');
        }
        const overrides = { statusLine: {
            type: 'command', command: commandString,
            padding: previous && statusLine?.padding !== undefined ? statusLine.padding : 0,
            ...(source === 'agy' ? { enabled: true, stack_with_default: previous && statusLine?.stack_with_default !== undefined ? statusLine.stack_with_default : true } : {}),
        } };
        return {
            command: { ...task, args: ['--settings', JSON.stringify(overrides), ...task.args] },
            resultFile,
            subscribe(receive) {
                return watchAgyMeterFile(resultFile, receive);
            },
            dispose,
        };
    } catch {
        dispose();
        return;
    }
}
