import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { win32, posix } from 'node:path';
import { promisify } from 'node:util';
import { cliIcon } from './cli-icons';
import type { LocalProfile } from './host';
import { t } from './i18n';

export interface Project {
    id: string;
    name: string;
    directory: string;
    distro?: string;
}

function stripOuterQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const quote = trimmed[0];
        if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
            return trimmed.slice(1, -1).trim();
        }
    }
    return trimmed;
}

function normalizePosixPath(value: string): string {
    const normalized = posix.normalize((value || '/').replace(/\\/g, '/'));
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function normalizeWindowsPath(value: string): string {
    const normalized = win32.normalize(value.replace(/\//g, '\\'));
    if (/^[a-zA-Z]:\\$/.test(normalized) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(normalized)) return normalized;
    return normalized.replace(/\\+$/, '');
}

export function projectLocation(directory: string, distro?: string): { directory: string; distro?: string } {
    const cleaned = stripOuterQuotes(directory);
    if (!cleaned) return { directory: '', distro };
    const share = cleaned.match(/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(.*)$/i);
    if (share) return { distro: share[1], directory: normalizePosixPath(share[2] || '/') };
    if (distro) {
        if (/^[a-zA-Z]:(?:[\\/]|$)/.test(cleaned)) {
            const drive = cleaned[0].toLowerCase();
            const rest = cleaned.slice(2).replace(/\\/g, '/');
            return { distro, directory: normalizePosixPath(`/mnt/${drive}${rest.startsWith('/') ? rest : `/${rest}`}`) };
        }
        return { distro, directory: normalizePosixPath(cleaned) };
    }
    return { directory: normalizeWindowsPath(cleaned), distro: undefined };
}

export async function resolveProjectLocation(directory: string, distro?: string): Promise<{ directory: string; distro?: string }> {
    const cleaned = stripOuterQuotes(directory);
    const base = projectLocation(cleaned, distro);
    if (distro && /^[a-zA-Z]:(?:[\\/]|$)/.test(cleaned) && !/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]/i.test(cleaned)) {
        try {
            const winArg = normalizeWindowsPath(cleaned);
            const { stdout } = await exec(wsl, linuxArgs(runtimeProject(distro), 'wslpath', ['-a', '-u', winArg]), probeOptions);
            const converted = stdout.trim();
            if (converted && posix.isAbsolute(converted)) {
                return { distro, directory: normalizePosixPath(converted) };
            }
        } catch { /* Fall back to synchronous drive mapping when WSL translation is unavailable. */ }
    }
    return base;
}

export interface Command {
    executable: string;
    args: string[];
    codexHome?: string;
    env?: Record<string, string>;
}

export const profilePrefix = 'tabby-oneai:';
const powershell = 'pwsh.exe';
const wsl = 'wsl.exe';
const exec = promisify(execFile);
const probeOptions = { timeout: 12000, windowsHide: true };
const quotePS = (value: string) => `'${value.replace(/'/g, "''")}'`;

function encoded(script: string): string[] {
    return ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

function linuxArgs(project: Project, command: string, args: string[]): string[] {
    return ['--distribution', project.distro!, '--cd', project.directory, '--exec', command, ...args];
}

export function environment(project: Project): string {
    return project.distro ? `WSL · ${project.distro}` : 'PowerShell 7';
}

export async function distributions(): Promise<string[]> {
    try {
        const { stdout } = await exec(wsl, ['--list', '--quiet'], { ...probeOptions, encoding: 'buffer' });
        const text = stdout.includes(0) ? stdout.toString('utf16le') : stdout.toString('utf8');
        return text.replace(/\uFEFF/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

export async function checkDirectory(project: Project): Promise<void> {
    if (project.distro) {
        if (!posix.isAbsolute(project.directory)) throw new Error(t('请输入 Linux 绝对路径。', 'Please enter a Linux absolute path.'));
        await exec(wsl, linuxArgs(project, 'test', ['-d', project.directory]), probeOptions);
    } else if (!win32.isAbsolute(project.directory) || !(await stat(project.directory)).isDirectory()) {
        throw new Error(t('请选择有效的 Windows 项目目录。', 'Please choose a valid Windows project folder.'));
    }
}

export async function cliDataPathExists(path: string, distro?: string, file = false): Promise<boolean | undefined> {
    if (distro && posix.isAbsolute(path)) {
        try {
            const args = ['-c', 'test "$1" "$2"; printf "%s" "$?"', '--', file ? '-f' : '-d', path];
            const { stdout } = await exec(wsl, linuxArgs(runtimeProject(distro), 'bash', args), probeOptions);
            if (stdout === '0' || stdout === '1') return stdout === '0';
        } catch { /* WSL may be temporarily unavailable. */ }
        return undefined;
    }
    try {
        const entry = await stat(path);
        return file ? entry.isFile() : entry.isDirectory();
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === 'ENOENT' || code === 'ENOTDIR' ? false : undefined;
    }
}

const linuxPathPrefix = 'for d in "$HOME/.opencode/bin" "$HOME/.local/bin" "$HOME/.bun/bin" "$HOME/.cargo/bin" "$HOME/bin" "$HOME/.npm-global/bin"; do [ -d "$d" ] && PATH="$d:$PATH"; done; export PATH=$(printf "%s" "$PATH" | awk -v RS=: -v ORS=: \'$0 !~ "^/mnt/[a-zA-Z](/|$)"\' | sed "s/:$//"); ';

export async function detect(project: Project, executable: string): Promise<boolean> {
    try {
        if (project.distro) {
            const linuxCheck = `${linuxPathPrefix}p=$(type -P -- "$1" 2>/dev/null) && [ -n "$p" ] && case "$p" in /mnt/*|*copilot-shim*) exit 1;; esac`;
            await exec(wsl, linuxArgs(project, 'bash', ['-lc', linuxCheck, '--', executable]), probeOptions);
        } else {
            const script = `$cmd = Get-Command -Name ${quotePS(executable)} -CommandType Application,ExternalScript -ErrorAction Stop | Where-Object { $_.Source -notmatch '[\\\\/]copilot-shim[\\\\/]' } | Select-Object -First 1; if (-not $cmd) { throw 'not found' }`;
            await exec(powershell, encoded(script), { ...probeOptions, cwd: project.directory });
        }
        return true;
    } catch {
        return false;
    }
}

export async function detectAvailableCli(distro: string | undefined, executables: readonly string[]): Promise<string[]> {
    const probe = 'tabby-oneai:';
    const windowsScript = `foreach ($name in @(${executables.map(quotePS).join(', ')})) {
        $cmd = Get-Command -Name $name -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch '[\\\\/]copilot-shim[\\\\/]' } | Select-Object -First 1
        if ($cmd) {
            [Console]::WriteLine('${probe}' + $name)
        }
    }
    exit 0`;
    const linuxScript = `${linuxPathPrefix}for name in "$@"; do
        p=$(type -P -- "$name" 2>/dev/null) || continue
        case "$p" in /mnt/*|*copilot-shim*) continue;; esac
        printf '${probe}%s\\n' "$name"
    done`;
    const { stdout } = distro
        ? await exec(wsl, linuxArgs(runtimeProject(distro), 'bash', ['-lc', linuxScript, '--', ...executables]), probeOptions)
        : await exec(powershell, encoded(windowsScript), { ...probeOptions, cwd: homedir() });
    const matches = new Set(stdout.split(/\r?\n/));
    return executables.filter(name => matches.has(probe + name));
}

export async function gitBranch(project: Project): Promise<string> {
    try {
        const args = ['branch', '--show-current'];
        const { stdout } = project.distro
            ? await exec(wsl, linuxArgs(project, 'git', args), probeOptions)
            : await exec('git.exe', args, { ...probeOptions, cwd: project.directory });
        return stdout.trim();
    } catch {
        return '';
    }
}

export function commandFor(project: Project, command: Command): LocalProfile['options'] {
    const invocation = [command.executable, ...command.args];
    const env = command.codexHome ? { ...command.env, CODEX_HOME: command.codexHome } : command.env;
    const variables = Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`);
    return project.distro
        ? { command: wsl, args: linuxArgs(project, 'bash', ['-lc', `${linuxPathPrefix}exec "$@"`, '--', ...(variables.length ? ['env', ...variables] : []), ...invocation]) }
        : {
            command: powershell,
            args: encoded(`& ${invocation.map(quotePS).join(' ')}; exit $LASTEXITCODE`),
            cwd: project.directory,
            env,
        };
}

export function terminalCommand(project: Project): Command {
    return project.distro ? { executable: 'bash', args: ['-l'] } : { executable: powershell, args: ['-NoLogo'] };
}

export function profileFor(id: string, title: string, project: Project, command: Command, color?: string): LocalProfile {
    return {
        id: profilePrefix + id, type: 'local', name: title,
        icon: cliIcon(command.executable), color,
        disableDynamicTitle: true, behaviorOnSessionEnd: 'close', options: commandFor(project, command),
    };
}

export function runtimeProject(distro?: string): Project {
    return { id: '', name: '', directory: distro ? '/' : homedir(), distro };
}

export async function cliSessionHomes(distro?: string): Promise<{ pi: string; kimi: string; kimiCode: string; agy: string; claude: string; grok: string; copilot: string }> {
    if (!distro) return {
        pi: win32.resolve(process.env.PI_CODING_AGENT_DIR || win32.join(homedir(), '.pi', 'agent')),
        kimi: win32.resolve(process.env.KIMI_SHARE_DIR || win32.join(homedir(), '.kimi')),
        kimiCode: win32.resolve(process.env.KIMI_CODE_HOME || win32.join(homedir(), '.kimi-code')),
        agy: win32.join(homedir(), '.gemini', 'antigravity-cli'),
        claude: win32.resolve(process.env.CLAUDE_CONFIG_DIR || win32.join(homedir(), '.claude')),
        grok: win32.resolve(process.env.GROK_HOME || win32.join(homedir(), '.grok')),
        copilot: win32.resolve(process.env.COPILOT_HOME || win32.join(homedir(), '.copilot')),
    };
    const script = 'printf "tabby-home\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" "${KIMI_SHARE_DIR:-$HOME/.kimi}" "$HOME/.gemini/antigravity-cli" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${KIMI_CODE_HOME:-$HOME/.kimi-code}" "${GROK_HOME:-$HOME/.grok}" "${COPILOT_HOME:-$HOME/.copilot}"';
    const { stdout } = await exec(wsl, linuxArgs(runtimeProject(distro), 'bash', ['-lc', script]), probeOptions);
    const [, pi, kimi, agy, claude, kimiCode, grok, copilot] = stdout.split(/\r?\n/).find(line => line.startsWith('tabby-home\t'))?.split('\t') ?? [];
    if (![pi, kimi, agy, claude, kimiCode, grok, copilot].every(value => value && posix.isAbsolute(value))) throw new Error(t('无法读取 WSL 的 CLI 会话目录。', 'Unable to read WSL CLI session directories.'));
    return { pi, kimi, agy, claude, kimiCode, grok, copilot };
}

export async function localReadPath(path: string, distro?: string): Promise<string> {
    if (!distro) return path;
    try {
        const { stdout } = await exec(wsl, linuxArgs(runtimeProject(distro), 'wslpath', ['-w', path]), probeOptions);
        const translated = stdout.trim();
        if (win32.isAbsolute(translated)) return translated;
    } catch { /* Older WSL versions can still expose the distribution share. */ }
    return `\\\\wsl.localhost\\${distro}${path.replace(/\//g, '\\')}`;
}

export async function readCliOutput(project: Project, command: Command): Promise<string> {
    const plan = commandFor(project, command);
    const { stdout } = await exec(plan.command, plan.args, { ...probeOptions, cwd: plan.cwd,
        env: plan.env && { ...process.env, ...plan.env }, maxBuffer: 32 * 1024 * 1024 });
    return stdout.trim();
}

export async function supportsAgyStatusSettings(project: Project, executable: string): Promise<boolean> {
    const plan = commandFor(project, { executable, args: ['--help'] });
    try {
        const result = await exec(plan.command, plan.args, { ...probeOptions, cwd: plan.cwd });
        return /(?:^|\s)--settings(?:\s|=)/m.test(result.stdout + '\n' + result.stderr);
    } catch (error) {
        const output = error as { stdout?: string; stderr?: string };
        return /(?:^|\s)--settings(?:\s|=)/m.test((output.stdout ?? '') + '\n' + (output.stderr ?? ''));
    }
}

export async function agyRuntimePaths(project: Project, paths: string[]): Promise<{ settings: string; native: string[] }> {
    const { distro } = project;
    if (!distro) return { settings: win32.join(homedir(), '.gemini', 'antigravity-cli', 'settings.json'), native: paths };
    const script = 'printf "%s\\n" "$HOME/.gemini/antigravity-cli/settings.json"; for path in "$@"; do wslpath -a -u "$path" || exit; done';
    const { stdout } = await exec(wsl, linuxArgs(project, 'bash', ['-lc', script, '--', ...paths]), probeOptions);
    const lines = stdout.trimEnd().split(/\r?\n/).slice(-paths.length - 1);
    const [settings, ...native] = lines;
    if (native.length !== paths.length || !lines.every(value => posix.isAbsolute(value))) throw new Error(t('无法定位 Antigravity 状态栏路径。', 'Unable to locate Antigravity status path.'));
    return { settings: await localReadPath(settings, distro), native };
}

export async function defaultCodexHome(distro?: string): Promise<string> {
    if (!distro) return win32.resolve(process.env.CODEX_HOME || win32.join(homedir(), '.codex'));
    const { stdout } = await exec(wsl, linuxArgs(runtimeProject(distro), 'bash', ['-lc', 'printf "\\n%s\\n" "${CODEX_HOME:-$HOME/.codex}"']), probeOptions);
    const home = stdout.trim().split(/\r?\n/).pop() ?? '';
    if (!posix.isAbsolute(home)) throw new Error(t('无法读取 WSL 的 Codex 默认目录。', 'Unable to read default WSL Codex directory.'));
    return posix.normalize(home);
}

export async function ensureCodexHome(directory: string, distro?: string): Promise<void> {
    if (distro) {
        await exec(wsl, linuxArgs(runtimeProject(distro), 'mkdir', ['-p', '--', directory]), probeOptions);
    } else {
        await mkdir(directory, { recursive: true });
    }
}
