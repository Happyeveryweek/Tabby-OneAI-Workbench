import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { win32, posix } from 'node:path';
import { promisify } from 'node:util';
import type { LocalProfile } from './host';

export interface Project {
    id: string;
    name: string;
    directory: string;
    distro?: string;
}

export interface Command {
    executable: string;
    args: string[];
}

export const supportedCli = [
    { name: 'Codex', executable: 'codex' },
    { name: 'OpenCode', executable: 'opencode' },
    { name: 'Pi', executable: 'pi' },
];
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
        if (!posix.isAbsolute(project.directory)) throw new Error('请输入 Linux 绝对路径。');
        await exec(wsl, linuxArgs(project, 'test', ['-d', project.directory]), probeOptions);
    } else if (!win32.isAbsolute(project.directory) || !(await stat(project.directory)).isDirectory()) {
        throw new Error('请选择有效的 Windows 项目目录。');
    }
}

export async function detect(project: Project, executable: string): Promise<boolean> {
    try {
        if (project.distro) {
            await exec(wsl, linuxArgs(project, 'bash', ['-lc', 'type -P -- "$1" >/dev/null', '--', executable]), probeOptions);
        } else {
            const script = `Get-Command -Name ${quotePS(executable)} -CommandType Application,ExternalScript -ErrorAction Stop | Out-Null`;
            await exec(powershell, encoded(script), { ...probeOptions, cwd: project.directory });
        }
        return true;
    } catch {
        return false;
    }
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

export function profileFor(id: string, title: string, project: Project, command: Command): LocalProfile {
    const options = project.distro
        ? { command: wsl, args: linuxArgs(project, 'bash', ['-lc', 'exec "$@"', '--', command.executable, ...command.args]) }
        : {
            command: powershell,
            args: encoded(`& ${[command.executable, ...command.args].map(quotePS).join(' ')}; exit $LASTEXITCODE`),
            cwd: project.directory,
        };
    return { id: profilePrefix + id, type: 'local', name: title, disableDynamicTitle: true, behaviorOnSessionEnd: 'keep', options };
}
