import { Injectable } from '@angular/core';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { defaultCodexHome, ensureCodexHome, localReadPath } from './commands';
import { clearLocalHistoryCache, clip, codexPrompt, findRollout, localDetails, localHistory, localPrompts, localQuota, LocalUsage, quotaFrom, sessionIdPattern } from './codex-data';
import type { CodexSession, Quota, SessionDetails, SessionPrompt, UsageReport } from './codex-data';
import type { CliSession } from './cli-history';
import { codexRead } from './codex-rpc';
import { t } from './i18n';

interface Account { id: string; name: string; directory: string; distro?: string; }
export interface CodexScope extends Account { key: string; home: string; }
export interface HistoryEntry extends CodexSession { scope: CodexScope; cli?: CliSession; }
export interface AccountUsage extends UsageReport { scope: CodexScope; }
type Reply = Record<string, any>;

const accountsKey = 'tabby-oneai.codex.accounts.v1';
const preferredKey = 'tabby-oneai.codex.preferred.v1';
export const defaultAccount = 'default';
export const codexTitleOption = 'tui.terminal_title=["session-id","status","spinner"]';
export const isCodex = (executable: string) => /^(?:codex|codex\.exe|codex\.cmd|codex\.ps1)$/i.test(executable);

function stored<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
    catch { return fallback; }
}

function cleanWindowsPath(value: string): string {
    return value.replace(/^\\\\\?\\/, '');
}

export function equalPath(left: string, right: string, distro?: string): boolean {
    return distro ? posix.resolve(left) === posix.resolve(right)
        : win32.resolve(cleanWindowsPath(left)).toLowerCase() === win32.resolve(cleanWindowsPath(right)).toLowerCase();
}

export function withinProject(cwd: string, root: string, distro?: string): boolean {
    const path = distro ? posix : win32;
    const cleanCwd = distro ? cwd : cleanWindowsPath(cwd);
    const cleanRoot = distro ? root : cleanWindowsPath(root);
    if (!path.isAbsolute(cleanCwd) || !path.isAbsolute(cleanRoot)) return false;
    if (equalPath(cleanCwd, cleanRoot, distro)) return true;
    const relative = distro
        ? posix.relative(posix.resolve(cleanRoot), posix.resolve(cleanCwd))
        : win32.relative(win32.resolve(cleanRoot).toLowerCase(), win32.resolve(cleanCwd).toLowerCase());
    return Boolean(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

export type CodexActivity = 'ready' | 'working' | 'waiting' | 'error';

export function codexTerminalTitle(text: string): { id?: string; activity?: CodexActivity } {
    const value = text.trim();
    const id = value.match(/(?:^|[|·]\s*)([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{4,12})(?:…|\.\.\.)?(?=\s|$)/i)?.[1].toLowerCase();
    if (/^(?:●\s*)?\[[ !.]+\]\s+Action Required\b/i.test(value)) return { id, activity: 'waiting' };
    const state = value.match(/(?:^|\s)(Ready|Working|Thinking|Waiting|Error|Failed)(?=\s|$)/i)?.[1].toLowerCase();
    const activity = state === 'ready' ? 'ready' : state === 'waiting' ? 'waiting'
        : state === 'error' || state === 'failed' ? 'error'
        : state === 'working' || state === 'thinking' ? 'working' : undefined;
    return { id, activity };
}

function asSession(value: any): CodexSession | undefined {
    if (!value || !sessionIdPattern.test(value.id) || typeof value.cwd !== 'string' || !value.cwd || value.ephemeral || value.parentThreadId) return;
    const updatedAt = Number(value.updatedAt ?? value.createdAt) * 1000;
    if (!Number.isFinite(updatedAt)) return;
    return { id: value.id, cwd: value.cwd, title: clip(value.name) || clip(value.preview) || t('Codex 会话', 'Codex Session'), updatedAt, model: clip(value.model) || undefined, effort: clip(value.reasoningEffort) || undefined };
}

@Injectable()
export class CodexService {
    accounts: Account[] = stored(accountsKey, []);
    private readonly defaults = new Map<string, Promise<string>>();
    private readonly readPaths = new Map<string, Promise<string>>();
    private readonly recent = new Map<string, { time: number; promise: Promise<CodexSession[]> }>();
    private readonly accountQuota = new Map<string, { checked: number; quota?: Quota }>();
    private readonly serverUsage = new Map<string, number>();
    private readonly serverSummary = new Map<string, { time: number; value: SessionDetails }>();
    private readonly usage = new LocalUsage();

    preferred(distro?: string): string {
        const id = stored<Record<string, string>>(preferredKey, {})[distro ?? ''];
        return this.accounts.some(account => account.id === id && account.distro === distro) ? id : defaultAccount;
    }

    setPreferred(scope: CodexScope): void {
        const data = stored<Record<string, string>>(preferredKey, {});
        localStorage.setItem(preferredKey, JSON.stringify({ ...data, [scope.distro ?? '']: scope.id }));
    }

    reloadDefault(distro?: string): void { this.defaults.delete(distro ?? ''); }

    clearHistoryCache(distro?: string): void {
        clearLocalHistoryCache();
        this.defaults.delete(distro ?? '');
        const prefix = `${distro ?? 'windows'}|`;
        for (const key of [...this.recent.keys()]) {
            if (!distro ? !key.includes('|') || key.startsWith(prefix) : key.startsWith(prefix) || key.includes(distro)) {
                this.recent.delete(key);
            }
        }
    }

    async scope(distro?: string, accountId = defaultAccount): Promise<CodexScope> {
        let account: Account;
        if (accountId === defaultAccount) {
            const key = distro ?? '';
            let value = this.defaults.get(key);
            if (!value) {
                value = defaultCodexHome(distro).catch(error => { this.defaults.delete(key); throw error; });
                this.defaults.set(key, value);
            }
            account = { id: defaultAccount, name: t('默认账号', 'Default account'), directory: await value, distro };
        } else {
            const found = this.accounts.find(item => item.id === accountId && item.distro === distro);
            if (!found) throw new Error(t('原 Codex 目录配置不存在，请在「CLI 环境与目录」中检查。', 'Original Codex directory config not found. Check CLI Environments.'));
            account = found;
        }
        return this.withPath(account);
    }

    async scopes(distros: (string | undefined)[]): Promise<CodexScope[]> {
        const result = await Promise.all([...new Set([...distros, ...this.accounts.map(item => item.distro)])].map(async distro => {
            const extras = await Promise.all(this.accounts.filter(item => item.distro === distro).map(item => this.withPath(item)));
            try { return [await this.scope(distro), ...extras]; }
            catch { return extras; }
        }));
        return result.flat();
    }

    async addAccount(name: string, directory: string, distro?: string): Promise<void> {
        const paths = distro ? posix : win32;
        if (!name || !paths.isAbsolute(directory)) throw new Error(t('请填写名称和当前运行环境的绝对路径。', 'Please enter a name and an absolute path for this environment.'));
        const resolved = paths.resolve(directory);
        const own = await this.scope(distro);
        const accounts = stored<Account[]>(accountsKey, []);
        if ([own, ...accounts].some(account => account.distro === distro && equalPath(account.directory, resolved, distro))) {
            throw new Error(t('该目录已用于当前环境的 Codex 账号。', 'This directory is already configured for a Codex account in this environment.'));
        }
        await ensureCodexHome(resolved, distro);
        const latest = stored<Account[]>(accountsKey, []);
        if (latest.some(account => account.distro === distro && equalPath(account.directory, resolved, distro))) return;
        this.accounts = [...latest, { id: randomUUID(), name, directory: resolved, distro }];
        localStorage.setItem(accountsKey, JSON.stringify(this.accounts));
    }

    async history(scope: CodexScope, cwd?: string, limit = 200, includeSubdirectories = false): Promise<HistoryEntry[]> {
        const acceptsDirectory = cwd ? (path: string) => includeSubdirectories ? withinProject(path, cwd, scope.distro) : equalPath(path, cwd, scope.distro) : undefined;
        const [local, native] = await Promise.all([
            localHistory(scope.home, limit, acceptsDirectory),
            this.nativeHistory(scope, cwd, includeSubdirectories),
        ]);
        const sessions = new Map(local.map(session => [session.id.toLowerCase(), session]));
        for (const session of native) {
            if (acceptsDirectory && !acceptsDirectory(session.cwd)) continue;
            const previous = sessions.get(session.id.toLowerCase());
            sessions.set(session.id.toLowerCase(), { ...previous, ...session });
        }
        return [...sessions.values()].map(session => ({ ...session, scope })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    }

    async report(scope: CodexScope): Promise<AccountUsage> {
        return { ...await this.usage.report(scope.home), scope };
    }

    async prompts(entry: HistoryEntry): Promise<SessionPrompt[]> {
        const file = entry.file ?? await findRollout(entry.scope.home, entry.id);
        const local = file ? await localPrompts(file) : [];
        if (local.length) return local;
        const prompts: SessionPrompt[] = [];
        let cursor: string | undefined;
        do {
            const [history] = await codexRead<Reply>(entry.scope.directory, entry.scope.distro, [
                { method: 'thread/turns/list', params: { threadId: entry.id, limit: 100, sortDirection: 'asc', itemsView: 'full', cursor } },
            ]);
            if (!Array.isArray(history?.data)) break;
            for (const turn of history.data) for (const item of Array.isArray(turn.items) ? turn.items : []) {
                if (item?.type !== 'userMessage' || !Array.isArray(item.content)) continue;
                const text = codexPrompt(item.content.filter((part: Reply) => part.type === 'text' && typeof part.text === 'string').map((part: Reply) => part.text).join('\n'));
                if (text) prompts.push({ text });
            }
            if (typeof history.nextCursor !== 'string' || history.nextCursor === cursor) break;
            cursor = history.nextCursor;
        } while (cursor);
        return prompts;
    }

    async sessionUsage(entry: HistoryEntry) {
        const file = entry.file ?? await findRollout(entry.scope.home, entry.id);
        return file ? this.usage.session(file) : [];
    }

    async match(scope: CodexScope, cwd: string, prefix: string): Promise<string | undefined> {
        const recent = await this.recentSessions(scope);
        let sessions = recent.filter(session => session.id.toLowerCase().startsWith(prefix) && equalPath(session.cwd, cwd, scope.distro));
        if (!sessions.length) {
            sessions = (await this.nativeHistory(scope, cwd)).filter(session => session.id.toLowerCase().startsWith(prefix) && equalPath(session.cwd, cwd, scope.distro));
        }
        return sessions.length === 1 ? sessions[0].id : undefined;
    }

    async details(scope: CodexScope, sessionId?: string): Promise<SessionDetails> {
        const sessions = sessionId ? await this.recentSessions(scope) : [];
        const local = sessions.find(item => item.id === sessionId);
        const file = local?.file ?? (sessionId ? await findRollout(scope.home, sessionId) : undefined);
        const detail = file ? await localDetails(file) : {};
        if (sessionId && (!detail.summary || !detail.model)) {
            const native = await this.nativeDetails(scope, sessionId);
            detail.summary ??= native.summary;
            detail.model ??= native.model;
            detail.effort ??= native.effort;
        }
        if (sessionId) detail.tokens ??= this.serverUsage.get(`${scope.key}:${sessionId}`);
        detail.quota = await this.quota(scope);
        return detail;
    }

    async refresh(scope: CodexScope, sessionId?: string): Promise<boolean> {
        const [limits, usage] = await codexRead<Reply>(scope.directory, scope.distro, [
            { method: 'account/rateLimits/read' },
            ...(sessionId ? [{ method: 'account/usage/read', params: { threadId: sessionId } }] : []),
        ]);
        const refreshed = quotaFrom(limits?.rateLimitsByLimitId?.codex ?? limits?.rateLimits, Date.now(), 'codex');
        if (refreshed) this.accountQuota.set(scope.key, { checked: Date.now(), quota: refreshed });
        const thread = usage?.threadUsage;
        if (sessionId && thread?.threadId === sessionId && Array.isArray(thread.groups)) {
            const values = thread.groups.map((group: Reply) => group.totalTokens);
            if (values.length && values.every((value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
                this.serverUsage.set(`${scope.key}:${sessionId}`, values.reduce((total: number, value: number) => total + value, 0));
            }
        }
        return Boolean(refreshed);
    }

    private async withPath(account: Account): Promise<CodexScope> {
        const directoryKey = `${account.distro ?? 'windows'}|${account.directory}`;
        let readable = this.readPaths.get(directoryKey);
        if (!readable) {
            readable = localReadPath(account.directory, account.distro);
            this.readPaths.set(directoryKey, readable);
        }
        return { ...account, key: `${account.distro ?? 'windows'}|${account.id}`, home: await readable };
    }

    private recentSessions(scope: CodexScope): Promise<CodexSession[]> {
        const cache = this.recent.get(scope.key);
        if (cache && Date.now() - cache.time < 5500) return cache.promise;
        const promise = localHistory(scope.home, 32);
        this.recent.set(scope.key, { time: Date.now(), promise });
        return promise;
    }

    private async quota(scope: CodexScope): Promise<Quota | undefined> {
        const cached = this.accountQuota.get(scope.key);
        if (cached && Date.now() - cached.checked < 5500) return cached.quota;
        const local = await localQuota(scope.home);
        const prior = this.accountQuota.get(scope.key)?.quota;
        const quota = local && (!prior || local.updatedAt > prior.updatedAt) ? local : prior;
        this.accountQuota.set(scope.key, { checked: Date.now(), quota });
        return quota;
    }

    private async nativeHistory(scope: CodexScope, cwd?: string, includeSubdirectories = false): Promise<CodexSession[]> {
        try { if (!(await stat(scope.home)).isDirectory()) return []; } catch { return []; }
        const base = { limit: 100, sortKey: 'updated_at', archived: false, useStateDbOnly: true, modelProviders: [] };
        const requests = cwd && includeSubdirectories
            ? [
                { method: 'thread/list', params: { ...base, cwd } },
                { method: 'thread/list', params: base },
            ]
            : [{ method: 'thread/list', params: { ...base, ...(cwd ? { cwd } : {}) } }];
        const replies = await codexRead<Reply>(scope.directory, scope.distro, requests);
        const sessions = new Map<string, CodexSession>();
        for (const reply of replies) {
            if (!Array.isArray(reply?.data)) continue;
            for (const raw of reply.data) {
                const session = asSession(raw);
                if (session) sessions.set(session.id.toLowerCase(), session);
            }
        }
        return [...sessions.values()];
    }

    private async nativeDetails(scope: CodexScope, threadId: string): Promise<SessionDetails> {
        const key = `${scope.key}:${threadId}`;
        const cached = this.serverSummary.get(key);
        if (cached && Date.now() - cached.time < 18000) return cached.value;
        const [metadata, history] = await codexRead<Reply>(scope.directory, scope.distro, [
            { method: 'thread/read', params: { threadId, includeTurns: false } },
            { method: 'thread/turns/list', params: { threadId, limit: 2, sortDirection: 'desc', itemsView: 'summary' } },
        ]);
        const thread = asSession(metadata?.thread);
        const turns = Array.isArray(history?.data) ? history.data : [];
        const user = turns.flatMap(turn => Array.isArray(turn.items) ? [...turn.items].reverse() : []).find(item => item.type === 'userMessage');
        const summary = Array.isArray(user?.content) ? clip(user.content.filter((item: Reply) => item.type === 'text').map((item: Reply) => item.text).join(' ')) : '';
        const value = { summary: summary || clip(metadata?.thread?.preview) || undefined, model: thread?.model, effort: thread?.effort };
        this.serverSummary.set(key, { time: Date.now(), value });
        return value;
    }
}
