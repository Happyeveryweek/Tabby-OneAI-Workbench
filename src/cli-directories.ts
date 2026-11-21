import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { checkDirectory, cliSessionHomes } from './commands';
import { equalPath } from './codex';
import { cliBrand } from './cli-icons';
import { t } from './i18n';

export const directoryVariables = { claude: 'CLAUDE_CONFIG_DIR', pi: 'PI_CODING_AGENT_DIR', kimi: 'KIMI_CODE_HOME', copilot: 'COPILOT_HOME' } as const;
export type ConfigurableCli = keyof typeof directoryVariables;
export const defaultDirectoryId = 'default';
export const kimiCodeDirectoryId = 'kimi-code-default';

export interface CliDirectory {
    id: string;
    name: string;
    directory: string;
    executable: ConfigurableCli;
    distro?: string;
}

const directoriesKey = 'tabby-oneai.cli-directories.v1';
const preferredKey = 'tabby-oneai.cli-directories.preferred.v1';

function stored<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
    catch { return fallback; }
}

export function configurableCli(executable: string): ConfigurableCli | undefined {
    const key = cliBrand(executable)?.executable;
    return key && Object.prototype.hasOwnProperty.call(directoryVariables, key) ? key as ConfigurableCli : undefined;
}

export class CliDirectories {
    private readonly discovered = new Map<string, ReturnType<typeof cliSessionHomes>>();

    homes(distro?: string): ReturnType<typeof cliSessionHomes> {
        const key = distro ?? '';
        let homes = this.discovered.get(key);
        if (!homes) {
            homes = cliSessionHomes(distro).catch(error => { this.discovered.delete(key); throw error; });
            this.discovered.set(key, homes);
        }
        return homes;
    }

    reload(distro?: string): void { this.discovered.delete(distro ?? ''); }

    async scopes(executable: ConfigurableCli, distro?: string): Promise<CliDirectory[]> {
        const extra = this.customScopes(executable, distro);
        try {
            const homes = await this.homes(distro);
            const root = { id: defaultDirectoryId, name: t('环境默认目录', 'Default environment directory'), executable, directory: homes[executable], distro };
            const defaults = executable === 'kimi' && !equalPath(homes.kimi, homes.kimiCode, distro)
                ? [{ ...root, id: kimiCodeDirectoryId, directory: homes.kimiCode }, { ...root, name: t('旧版默认目录', 'Legacy default directory') }]
                : [root];
            return [...defaults, ...extra.filter(item => !defaults.some(itemDefault => equalPath(item.directory, itemDefault.directory, distro)))];
        } catch { return extra; }
    }

    async add(executable: ConfigurableCli, name: string, input: string, distro?: string): Promise<void> {
        const path = distro ? posix : win32;
        if (!name || !path.isAbsolute(input)) throw new Error(t('请填写名称和当前运行环境的绝对路径。', 'Please enter a name and an absolute path for this environment.'));
        const directory = path.resolve(input);
        await checkDirectory({ id: '', name, directory, distro });
        const present = await this.scopes(executable, distro);
        const latest = stored<CliDirectory[]>(directoriesKey, []);
        if ([...present, ...latest.filter(item => item.executable === executable && item.distro === distro)]
            .some(item => equalPath(item.directory, directory, distro))) throw new Error(t('当前 CLI 已配置这个目录。', 'This directory is already configured for this CLI.'));
        localStorage.setItem(directoriesKey, JSON.stringify([...latest, { id: randomUUID(), executable, name, directory, distro }]));
    }

    preferred(executable: ConfigurableCli, distro?: string): CliDirectory | undefined {
        const id = stored<Record<string, string>>(preferredKey, {})[this.key(executable, distro)];
        return this.customScopes(executable, distro).find(item => item.id === id);
    }

    setPreferred(scope: CliDirectory): void {
        const data = stored<Record<string, string>>(preferredKey, {});
        localStorage.setItem(preferredKey, JSON.stringify({ ...data, [this.key(scope.executable, scope.distro)]: scope.id }));
    }

    private customScopes(executable: ConfigurableCli, distro?: string): CliDirectory[] {
        return stored<CliDirectory[]>(directoriesKey, []).filter(item => item.executable === executable && item.distro === distro);
    }

    private key(executable: ConfigurableCli, distro?: string): string {
        return `${distro?.toLowerCase() ?? 'windows'}|${executable}`;
    }
}
