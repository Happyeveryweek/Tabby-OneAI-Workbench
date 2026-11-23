import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { localReadPath, readCliOutput } from './commands';
import type { Project } from './commands';
import { clip, isAbortMessage, json, jsonLines, sessionIdPattern } from './codex-data';
import type { SessionDetails, SessionPrompt, UsageEntry } from './codex-data';
import { withinProject } from './codex';
import { CliDirectories } from './cli-directories';
import type { CliDirectory } from './cli-directories';
import { t } from './i18n';

export interface CliSession {
    id: string;
    cwd: string;
    title: string;
    updatedAt: number;
    executable: 'agy' | 'pi' | 'opencode' | 'kimi' | 'claude' | 'grok' | 'copilot';
    args: string[];
    distro?: string;
    promptFile?: string;
    wireFile?: string;
    stateFile?: string;
    dataDirectory?: string;
    directoryId?: string;
}

async function readJson(file: string) {
    try { return json(await readFile(file, 'utf8')); } catch { return undefined; }
}

async function children(directory: string) {
    try { return await readdir(directory, { withFileTypes: true }); } catch { return []; }
}

async function sample(file: string): Promise<string[]> {
    const handle = await open(file, 'r');
    try {
        const buffer = Buffer.alloc(48 * 1024);
        const { bytesRead } = await handle.read(buffer);
        return buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    } finally { await handle.close(); }
}

function messageText(content: unknown): string {
    return typeof content === 'string' ? content.trim() : Array.isArray(content) ? content
        .filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n').trim() : '';
}

const execFileAsync = promisify(execFile);

interface AgySummaryRow {
    id: string;
    title: string;
    preview: string;
    stepCount: number;
    updatedAt: number;
    workspaceUris: string[];
    parentId?: string;
    nestingDepth?: number;
}

interface NodeSqliteModule {
    DatabaseSync: new (path: string, options?: { readOnly?: boolean; timeout?: number }) => {
        prepare(sql: string): { all(): Record<string, unknown>[] };
        close(): void;
    };
}

let cachedNodeSqlite: NodeSqliteModule | null | undefined;

function getNodeSqlite(): NodeSqliteModule | null {
    if (cachedNodeSqlite !== undefined) return cachedNodeSqlite;
    try {
        const mod = require('node:sqlite') as Partial<NodeSqliteModule> | undefined;
        cachedNodeSqlite = typeof mod?.DatabaseSync === 'function' ? (mod as NodeSqliteModule) : null;
    } catch {
        cachedNodeSqlite = null;
    }
    return cachedNodeSqlite;
}

const agyDbOptionalColumns = ['title', 'preview', 'step_count', 'last_modified_time', 'workspace_uris', 'parent_conversation_id', 'nesting_depth'] as const;

const agyNodeSqliteScript = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true, timeout: 1500 });
try {
    const cols = new Set(db.prepare('PRAGMA table_info(conversation_summaries)').all().map(r => String(r.name || '')));
    if (!cols.has('conversation_id')) { process.stdout.write('[]'); return; }
    const wanted = ['conversation_id', 'title', 'preview', 'step_count', 'last_modified_time', 'workspace_uris', 'parent_conversation_id', 'nesting_depth'].filter(c => cols.has(c));
    const rows = db.prepare('SELECT ' + wanted.join(', ') + ' FROM conversation_summaries').all();
    process.stdout.write(JSON.stringify(rows));
} finally { db.close(); }
`;

const agyPythonSqliteScript = `
import json, sqlite3, sys
path = sys.argv[1]
def query(uri):
    con = sqlite3.connect(uri, uri=True, timeout=2.0)
    try:
        cols = {row[1] for row in con.execute('PRAGMA table_info(conversation_summaries)').fetchall()}
        if 'conversation_id' not in cols:
            return []
        wanted = [c for c in ('conversation_id', 'title', 'preview', 'step_count', 'last_modified_time', 'workspace_uris', 'parent_conversation_id', 'nesting_depth') if c in cols]
        rows = con.execute('SELECT ' + ', '.join(wanted) + ' FROM conversation_summaries').fetchall()
        return [dict(zip(wanted, row)) for row in rows]
    finally:
        con.close()
try:
    data = query(f'file:{path}?mode=ro')
except sqlite3.OperationalError:
    data = query(f'file:{path}?mode=ro&immutable=1')
sys.stdout.write(json.dumps(data))
`;

function parseAgyWorkspaceUris(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function normalizeAgyDbRows(rawRows: unknown): AgySummaryRow[] {
    if (!Array.isArray(rawRows)) return [];
    const results: AgySummaryRow[] = [];
    for (const raw of rawRows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const id = typeof row.conversation_id === 'string' ? row.conversation_id : '';
        if (!isId(id)) continue;
        const stepCount = typeof row.step_count === 'number' && Number.isFinite(row.step_count) ? row.step_count : 0;
        const nestingDepth = typeof row.nesting_depth === 'number' && Number.isFinite(row.nesting_depth) ? row.nesting_depth : 0;
        const parentId = typeof row.parent_conversation_id === 'string' ? row.parent_conversation_id.trim() : '';
        results.push({
            id,
            title: clip(row.title),
            preview: clip(row.preview),
            stepCount,
            updatedAt: when(row.last_modified_time) ?? 0,
            workspaceUris: parseAgyWorkspaceUris(row.workspace_uris),
            parentId: parentId || undefined,
            nestingDepth,
        });
    }
    return results;
}

function queryAgyDbInProcess(dbFile: string): AgySummaryRow[] | undefined {
    const sqlite = getNodeSqlite();
    if (!sqlite) return undefined;
    try {
        const db = new sqlite.DatabaseSync(dbFile, { readOnly: true, timeout: 1500 });
        try {
            const cols = new Set(db.prepare('PRAGMA table_info(conversation_summaries)').all().map(r => String(r.name ?? '')));
            if (!cols.has('conversation_id')) return [];
            const wanted = ['conversation_id', ...agyDbOptionalColumns.filter(col => cols.has(col))];
            const rows = db.prepare(`SELECT ${wanted.join(', ')} FROM conversation_summaries`).all();
            return normalizeAgyDbRows(rows);
        } finally {
            db.close();
        }
    } catch {
        return undefined;
    }
}

async function queryAgyDbSubprocess(dbPath: string, distro?: string): Promise<AgySummaryRow[] | undefined> {
    const options = { timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
    const parseStdout = (stdout: string): AgySummaryRow[] | undefined => {
        const start = stdout.indexOf('[');
        if (start < 0) return undefined;
        try { return normalizeAgyDbRows(JSON.parse(stdout.slice(start))); } catch { return undefined; }
    };
    if (distro) {
        try {
            const { stdout } = await execFileAsync(
                'wsl.exe',
                ['--distribution', distro, '--cd', '/', '--exec', 'python3', '-c', agyPythonSqliteScript, dbPath],
                options,
            );
            const parsed = parseStdout(stdout);
            if (parsed !== undefined) return parsed;
        } catch { /* Fall back to WSL node:sqlite when python3 is unavailable. */ }
        try {
            const { stdout } = await execFileAsync(
                'wsl.exe',
                ['--distribution', distro, '--cd', '/', '--exec', 'node', '--no-warnings', '-e', agyNodeSqliteScript, dbPath],
                options,
            );
            const parsed = parseStdout(stdout);
            if (parsed !== undefined) return parsed;
        } catch {
            return undefined;
        }
        return undefined;
    }
    try {
        const { stdout } = await execFileAsync('node', ['--no-warnings', '-e', agyNodeSqliteScript, dbPath], options);
        const parsed = parseStdout(stdout);
        if (parsed !== undefined) return parsed;
    } catch { /* Fall back to Windows python sqlite3 if system node lacks node:sqlite. */ }
    for (const [cmd, prefix] of [['python', ['-c']], ['py', ['-3', '-c']]] as const) {
        try {
            const { stdout } = await execFileAsync(cmd, [...prefix, agyPythonSqliteScript, dbPath], options);
            const parsed = parseStdout(stdout);
            if (parsed !== undefined) return parsed;
        } catch { /* Try next fallback. */ }
    }
    return undefined;
}

function when(value: unknown): number | undefined {
    if (typeof value === 'number') {
        const time = value * (value < 1e11 ? 1000 : 1);
        return Number.isFinite(time) && time > 0 ? time : undefined;
    }
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || /^0001-01-01\b/.test(trimmed)) return undefined;
    const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
    const time = Date.parse(normalized);
    return Number.isFinite(time) && time > 0 ? time : undefined;
}

function pathFromWorkspace(value: unknown, distro?: string): string {
    if (typeof value !== 'string') return '';
    if (!value.startsWith('file:')) return value;
    try {
        const uri = new URL(value);
        if (uri.hostname && uri.hostname !== 'localhost') return '';
        const path = decodeURIComponent(uri.pathname);
        return distro ? path : win32.normalize(path.replace(/^\/(?=[a-z]:)/i, ''));
    } catch { return ''; }
}

const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{5,100}$/i.test(value);
const tokens = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

function inferContextWindow(model: string | undefined): number | undefined {
    if (!model) return undefined;
    const lower = model.toLowerCase();
    if (/gemini-(?:1\.5|2\.|3\.|4|pro|flash|ultra)/i.test(lower)) return 1_000_000;
    if (/kimi|moonshot/i.test(lower)) return 262_144;
    if (/claude-(?:3|4|sonnet|opus|haiku)/i.test(lower)) return 200_000;
    if (/grok-4/i.test(lower)) return 256_000;
    if (/grok-3|grok-2/i.test(lower)) return 131_072;
    if (/gpt-5|codex/i.test(lower)) return 272_000;
    if (/gpt-4\.1/i.test(lower)) return 1_000_000;
    if (/gpt-4o|o1|o3|o4|deepseek/i.test(lower)) return 128_000;
    return undefined;
}

export class CliHistory {
    private readonly usageCache = new Map<string, { mtime: number; size: number; entries: UsageEntry[]; detail: SessionDetails }>();
    private readonly sessionFileCache = new Map<string, { mtime: number; session: CliSession | null }>();
    private readonly agyHistoryCache = new Map<string, { mtime: number; size: number; items: Map<string, { cwd: string; title: string; updatedAt: number }> }>();
    private readonly agyDbCache = new Map<string, { sig: string; rows: AgySummaryRow[] }>();
    private readonly agyDbPending = new Map<string, Promise<AgySummaryRow[]>>();

    constructor(private readonly directories = new CliDirectories()) {}

    clearCache(): void {
        this.sessionFileCache.clear();
        this.agyHistoryCache.clear();
        this.agyDbCache.clear();
    }

    async list(project: Project, limit: number, available: (name: string) => Promise<boolean>): Promise<CliSession[]> {
        const homesPromise = this.directories.homes(project.distro).catch(() => undefined);
        const [pi, agy, kimi, claude, openCode, grok, copilot] = await Promise.all([
            this.inDirectories(project, 'pi'),
            homesPromise.then(homes => homes ? this.agy(project, homes.agy) : []).catch(() => []),
            this.inDirectories(project, 'kimi'),
            this.inDirectories(project, 'claude'),
            available('opencode').then(found => found ? this.openCode(project, limit) : []).catch(() => []),
            homesPromise.then(homes => homes ? this.grok(project, homes.grok) : []).catch(() => []),
            this.inDirectories(project, 'copilot'),
        ]);
        return [pi, agy, kimi, claude, openCode, grok, copilot].flatMap(items => items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit));
    }

    async listForCli(project: Project, executable: CliSession['executable'], limit = 15): Promise<CliSession[]> {
        try {
            const items = executable === 'agy'
                ? await this.directories.homes(project.distro).then(homes => this.agy(project, homes.agy))
                : executable === 'grok'
                ? await this.directories.homes(project.distro).then(homes => this.grok(project, homes.grok))
                : executable === 'opencode'
                ? await this.openCode(project, limit)
                : await this.inDirectories(project, executable);
            return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
        } catch {
            return [];
        }
    }

    private async inDirectories(project: Project, executable: CliDirectory['executable']): Promise<CliSession[]> {
        const scopes = await this.directories.scopes(executable, project.distro);
        const matches = await Promise.all(scopes.map(async scope => {
            const sessions = await this[executable](project, scope.directory).catch(() => []);
            return sessions.map(session => ({ ...session, directoryId: scope.id, dataDirectory: scope.directory }));
        }));
        return matches.flat();
    }

    async prompts(project: Project, session: CliSession): Promise<SessionPrompt[]> {
        const file = session.promptFile;
        if (session.executable === 'opencode') {
            try {
                const data = await this.exportOpenCodeSession(project, session.id);
                return Array.isArray(data?.messages) ? data.messages.flatMap((entry: any) => {
                    const isUser = entry?.type === 'user' || entry?.role === 'user' || entry?.info?.role === 'user';
                    const text = isUser ? messageText(entry.text ?? entry.content ?? entry.parts) : '';
                    return text ? [{ text, at: when(entry.time?.created ?? entry.info?.time?.created) }] : [];
                }) : [];
            } catch { return []; }
        }
        if (!file) {
            const state = session.stateFile && await readJson(session.stateFile);
            const text = messageText(state && state.lastPrompt);
            return text ? [{ text, at: session.updatedAt }] : [];
        }
        const prompts: SessionPrompt[] = [];
        for await (const item of jsonLines(file)) {
            const text = session.executable === 'agy' ? item.conversationId === session.id && messageText(item.display)
                : session.executable === 'grok'
                ? (item.session_id === session.id && !item.is_bash && messageText(item.prompt))
                    || (item.params?.update?.sessionUpdate === 'user_message_chunk' && messageText(item.params.update.content?.text ?? item.params.update.content))
                : session.executable === 'pi' ? item.type === 'message' && item.message?.role === 'user' && messageText(item.message.content)
                : session.executable === 'claude' ? item.type === 'user' && !item.isMeta && messageText(item.message?.content)
                : session.executable === 'copilot' ? item.type === 'user.message' && messageText(item.data?.content ?? item.data?.prompt ?? item.content)
                : item.role === 'user' && messageText(item.content);
            if (text) prompts.push({ text, at: when(item.timestamp ?? item.params?._meta?.agentTimestampMs ?? item.message?.timestamp) });
        }
        return prompts;
    }

    async usage(session: CliSession): Promise<UsageEntry[]> {
        return (await this.readUsage(session))?.entries ?? [];
    }

    async details(session: CliSession): Promise<SessionDetails | undefined> {
        return (await this.readUsage(session))?.detail;
    }

    private async readUsage(session: CliSession) {
        const { executable } = session;
        if (executable === 'grok') return this.readGrokUsage(session);
        if (executable === 'opencode') return this.readOpenCodeUsage(session);
        if (executable === 'copilot') return this.readCopilotUsage(session);
        const file = executable === 'agy'
            ? session.wireFile ?? (session.promptFile && win32.join(win32.dirname(session.promptFile), 'brain', session.id, '.system_generated', 'logs', 'transcript.jsonl'))
            : executable === 'kimi'
            ? session.wireFile ?? (session.promptFile && win32.join(win32.dirname(session.promptFile), 'wire.jsonl'))
            : session.promptFile;
        if (!file || (executable !== 'agy' && executable !== 'pi' && executable !== 'claude' && executable !== 'kimi')) return;
        const info = await stat(file).catch(() => undefined);
        if (!info) return;
        const cached = this.usageCache.get(file);
        if (cached?.mtime === info.mtimeMs && cached.size === info.size) return cached;
        const entries = new Map<string | number, UsageEntry>();
        const detail: SessionDetails = {};
        if (executable === 'kimi' && session.stateFile) {
            const state = await readJson(session.stateFile);
            const stateModel = clip(state?.model ?? state?.modelName ?? state?.currentModel);
            if (stateModel) detail.model = stateModel;
        }
        let lastContextTokens = 0;
        for await (const item of jsonLines(file)) {
            const message = item.message;
            let entry: UsageEntry | undefined;
            let key: string | number = entries.size;
            const date = when(item.timestamp ?? item.time ?? item.created_at ?? message?.timestamp);
            if (executable === 'agy') {
                if (typeof item.status === 'string') detail.hasError = item.status === 'ERROR';
                if (date !== undefined) {
                    if (typeof item.step_index === 'number') key = item.step_index;
                    entry = { date, model: clip(item.model) || '未知模型', input: tokens(item.input_tokens),
                        cached: tokens(item.cache_read_tokens), output: tokens(item.output_tokens) };
                }
            } else if (executable === 'pi') {
                if (item.type === 'model_change' && typeof item.modelId === 'string') {
                    detail.model = clip(item.modelId) || detail.model;
                } else if (item.type === 'thinking_level_change' && typeof item.thinkingLevel === 'string') {
                    const lvl = clip(item.thinkingLevel);
                    detail.effort = lvl && lvl !== 'off' ? lvl : undefined;
                } else if (item.type === 'message' && message?.role === 'user') {
                    detail.hasError = false;
                } else if (item.type === 'message' && message?.role === 'assistant') {
                    if (message.stopReason === 'aborted' || isAbortMessage(message.errorMessage)) {
                        detail.hasError = false;
                    } else {
                        detail.hasError = message.stopReason === 'error' || Boolean(message.errorMessage);
                    }
                    if (typeof message.model === 'string') detail.model = clip(message.model) || detail.model;
                    if (typeof message.thinkingLevel === 'string') {
                        const lvl = clip(message.thinkingLevel);
                        detail.effort = lvl && lvl !== 'off' ? lvl : undefined;
                    }
                    if (message.usage && date !== undefined) {
                        const data = message.usage;
                        const input = tokens(data.input) + tokens(data.cacheWrite);
                        const cached = tokens(data.cacheRead);
                        const output = tokens(data.output);
                        const turnTokens = tokens(data.totalTokens) || (input + cached + output);
                        if (turnTokens > 0 && message.stopReason !== 'aborted') lastContextTokens = turnTokens;
                        entry = { date, model: clip(message.model) || detail.model || '未知模型', input, cached, output };
                    }
                }
            } else if (executable === 'claude') {
                if (item.type === 'user' && !item.isMeta) {
                    detail.hasError = false;
                } else if (item.type === 'system' && item.subtype === 'api_error') {
                    detail.hasError = true;
                } else if (item.type === 'assistant' && !item.isSidechain) {
                    if (message?.stop_reason === 'aborted' || isAbortMessage(item.error)) {
                        detail.hasError = false;
                    } else {
                        detail.hasError = Boolean(item.isApiErrorMessage || item.error || message?.stop_reason === 'error');
                    }
                    if (message?.usage && date !== undefined) {
                        const data = message.usage;
                        if (message.id) key = message.id;
                        if (typeof message.model === 'string') detail.model = clip(message.model) || detail.model;
                        const input = tokens(data.input_tokens) + tokens(data.cache_creation_input_tokens);
                        const cached = tokens(data.cache_read_input_tokens);
                        const output = tokens(data.output_tokens);
                        if (input + cached + output > 0) lastContextTokens = input + cached + output;
                        entry = { date, model: clip(message.model) || '未知模型', input, cached, output };
                    }
                }
            } else if (executable === 'kimi') {
                if (item.type === 'llm.request' || item.type === 'turn.cancel' || item.type === 'turn.cancelled' || item.type === 'turn.aborted' || item.type === 'turn.interrupted') {
                    detail.hasError = false;
                    if (typeof item.model === 'string') detail.model = clip(item.model) || detail.model;
                    if ('thinkingEffort' in item) detail.effort = clip(item.thinkingEffort) || undefined;
                } else if (item.type === 'turn.fail' || item.type === 'llm.error' || item.type === 'error' || item.message?.type === 'Error') {
                    const errMsg = item.error ?? item.reason ?? item.message?.error ?? item.message?.message;
                    detail.hasError = !(item.cancelled || item.aborted || isAbortMessage(errMsg));
                }
                if (item.type === 'usage.record' && item.usage && date !== undefined) {
                    detail.hasError = false;
                    const data = item.usage;
                    if (typeof item.model === 'string') detail.model = clip(item.model) || detail.model;
                    key = typeof item.id === 'string' ? item.id : `usage:${date}:${item.model}`;
                    const input = tokens(data.inputOther) + tokens(data.inputCacheCreation);
                    const cached = tokens(data.inputCacheRead);
                    const output = tokens(data.output);
                    if (input + cached + output > 0) lastContextTokens = input + cached + output;
                    entry = { date, model: clip(item.model) || '未知模型', input, cached, output };
                } else if (item.message?.type === 'StatusUpdate') {
                    // Legacy wire persists the same StatusUpdate fields used by wire mode.
                    const status = item.message.payload;
                    const ratio = status?.context_usage;
                    if (typeof ratio === 'number' && ratio >= 0 && ratio <= 1) detail.context = {
                        percent: ratio * 100, tokens: tokens(status.context_tokens) || undefined, window: tokens(status.max_context_tokens) || undefined,
                    };
                    const data = status?.token_usage;
                    if (data && typeof status.message_id === 'string' && date !== undefined) {
                        key = status.message_id;
                        const input = tokens(data.input_other) + tokens(data.input_cache_creation);
                        const cached = tokens(data.input_cache_read);
                        const output = tokens(data.output);
                        if (input + cached + output > 0) lastContextTokens = input + cached + output;
                        entry = { date, model: '未知模型', input: tokens(data.input_other) + tokens(data.input_cache_creation),
                            cached: tokens(data.input_cache_read), output: tokens(data.output) };
                    }
                }
            }
            if (entry && entry.input + entry.cached + entry.output > 0) entries.set(key, entry);
        }
        const result = { mtime: info.mtimeMs, size: info.size, entries: [...entries.values()].sort((a, b) => a.date - b.date), detail };
        const last = result.entries.at(-1);
        if (last) {
            if (!detail.model) detail.model = last.model === '未知模型' ? undefined : last.model;
            detail.tokens = result.entries.reduce((total, entry) => total + entry.input + entry.cached + entry.output, 0);
        }
        if (!detail.context && lastContextTokens > 0) {
            const window = inferContextWindow(detail.model);
            const percent = window ? Math.min(100, Math.max(0, (lastContextTokens / window) * 100)) : undefined;
            detail.context = { tokens: lastContextTokens, window, percent };
        }
        if (this.usageCache.size >= 256) this.usageCache.delete(this.usageCache.keys().next().value!);
        this.usageCache.set(file, result);
        return result;
    }

    private async pi(project: Project, home: string): Promise<CliSession[]> {
        const path = project.distro ? posix : win32;
        const root = path.join(home, 'sessions');
        const readable = await localReadPath(root, project.distro);
        const results: CliSession[] = [];
        for (const folder of await children(readable)) {
            if (!folder.isDirectory()) continue;
            const directory = path.join(root, folder.name);
            const localDirectory = win32.join(readable, folder.name);
            for (const file of await children(localDirectory)) {
                if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
                const nativeFile = path.join(directory, file.name);
                const localFile = win32.join(localDirectory, file.name);
                const cached = this.sessionFileCache.get(localFile);
                if (cached?.session && !withinProject(cached.session.cwd, project.directory, project.distro)) continue;
                try {
                    const info = await stat(localFile);
                    if (cached && cached.mtime === info.mtimeMs) {
                        if (cached.session && withinProject(cached.session.cwd, project.directory, project.distro)) {
                            results.push(cached.session);
                        }
                        continue;
                    }
                    const lines = await sample(localFile);
                    const meta = json(lines[0]);
                    if (meta?.type !== 'session' || !isId(meta.id) || typeof meta.cwd !== 'string') {
                        this.sessionFileCache.set(localFile, { mtime: info.mtimeMs, session: null });
                        continue;
                    }
                    const records = lines.map(json);
                    const first = records.find(item => item?.type === 'message' && item.message?.role === 'user');
                    const title = clip(records.filter(item => item?.type === 'session_info').at(-1)?.name) || clip(messageText(first?.message?.content));
                    if (!title) {
                        this.sessionFileCache.set(localFile, { mtime: info.mtimeMs, session: null });
                        continue;
                    }
                    const session: CliSession = { id: meta.id, cwd: meta.cwd, title, executable: 'pi', args: ['--session', nativeFile],
                        promptFile: localFile, updatedAt: info.mtimeMs };
                    if (this.sessionFileCache.size >= 512) this.sessionFileCache.delete(this.sessionFileCache.keys().next().value!);
                    this.sessionFileCache.set(localFile, { mtime: info.mtimeMs, session });
                    if (withinProject(meta.cwd, project.directory, project.distro)) results.push(session);
                } catch { /* The CLI may still be writing or rotating the file. */ }
            }
        }
        return results;
    }

    private async readAgySummariesDb(home: string, readable: string, distro?: string): Promise<AgySummaryRow[]> {
        const dbFile = win32.join(readable, 'conversation_summaries.db');
        const walFile = win32.join(readable, 'conversation_summaries.db-wal');
        const [dbInfo, walInfo] = await Promise.all([
            stat(dbFile).catch(() => undefined),
            stat(walFile).catch(() => undefined),
        ]);
        if (!dbInfo) return [];
        const sig = `${dbInfo.mtimeMs}:${dbInfo.size}|${walInfo?.mtimeMs ?? 0}:${walInfo?.size ?? 0}`;
        const cached = this.agyDbCache.get(dbFile);
        if (cached && cached.sig === sig) return cached.rows;
        const pendingKey = `${dbFile}|${sig}`;
        let pending = this.agyDbPending.get(pendingKey);
        if (!pending) {
            pending = (async () => {
                if (!distro) {
                    const direct = queryAgyDbInProcess(dbFile);
                    if (direct !== undefined) return direct;
                }
                const nativeDbPath = distro ? posix.join(home, 'conversation_summaries.db') : dbFile;
                return queryAgyDbSubprocess(nativeDbPath, distro);
            })().then(rows => {
                if (rows !== undefined) {
                    this.agyDbCache.set(dbFile, { sig, rows });
                    return rows;
                }
                return [];
            }).finally(() => {
                this.agyDbPending.delete(pendingKey);
            });
            this.agyDbPending.set(pendingKey, pending);
        }
        return pending;
    }

    private async agy(project: Project, home: string): Promise<CliSession[]> {
        const readable = await localReadPath(home, project.distro);
        const [meta, dbRows] = await Promise.all([
            readJson(win32.join(readable, 'cache', 'conversation_metadata.json')),
            this.readAgySummariesDb(home, readable, project.distro).catch(() => [] as AgySummaryRow[]),
        ]);
        const file = win32.join(readable, 'history.jsonl');
        const transcriptFor = (id: string) => win32.join(readable, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
        const sessions = new Map<string, CliSession>();
        const blockedIds = new Set<string>();
        const knownOtherWorkspaceIds = new Set<string>();
        for (const [id, entry] of Object.entries(meta?.conversations ?? {}) as [string, any][]) {
            const summary = entry?.summary;
            if (!isId(id) || !summary) continue;
            if (entry.is_internal || summary.Internal || summary.Cloud) {
                blockedIds.add(id);
                continue;
            }
            const title = clip(summary.Title) || clip(summary.Preview);
            if (!title && typeof summary.NumSteps === 'number' && summary.NumSteps <= 0) {
                blockedIds.add(id);
                continue;
            }
            const cwd = (Array.isArray(summary.WorkspaceURIs) ? summary.WorkspaceURIs : []).map((uri: unknown) => pathFromWorkspace(uri, project.distro))
                .find((candidate: string) => withinProject(candidate, project.directory, project.distro));
            if (!cwd) {
                knownOtherWorkspaceIds.add(id);
                continue;
            }
            sessions.set(id, { id, cwd, title: title || 'Antigravity 会话',
                executable: 'agy', args: ['--conversation', id], promptFile: file, wireFile: transcriptFor(id),
                updatedAt: when(summary.UpdatedAt) ?? when(entry.last_modified_time) ?? 0 });
        }
        for (const row of dbRows) {
            if (blockedIds.has(row.id)) continue;
            if (row.parentId || (row.nestingDepth ?? 0) > 0) {
                blockedIds.add(row.id);
                sessions.delete(row.id);
                continue;
            }
            const rowTitle = row.title || row.preview;
            if (!rowTitle && row.stepCount <= 0) {
                blockedIds.add(row.id);
                continue;
            }
            const existing = sessions.get(row.id);
            if (existing) {
                existing.updatedAt = Math.max(existing.updatedAt, row.updatedAt);
                if (rowTitle && (!existing.title || existing.title === 'Antigravity 会话' || existing.title.startsWith('/'))) {
                    existing.title = rowTitle;
                }
                continue;
            }
            const cwd = row.workspaceUris.map(uri => pathFromWorkspace(uri, project.distro))
                .find(candidate => withinProject(candidate, project.directory, project.distro));
            if (!cwd) {
                knownOtherWorkspaceIds.add(row.id);
                continue;
            }
            sessions.set(row.id, {
                id: row.id,
                cwd,
                title: rowTitle || 'Antigravity 会话',
                executable: 'agy',
                args: ['--conversation', row.id],
                promptFile: file,
                wireFile: transcriptFor(row.id),
                updatedAt: row.updatedAt,
            });
        }
        const info = await stat(file).catch(() => undefined);
        let historyMap = info ? this.agyHistoryCache.get(file) : undefined;
        if (info && (!historyMap || historyMap.mtime !== info.mtimeMs || historyMap.size !== info.size)) {
            const items = new Map<string, { cwd: string; title: string; updatedAt: number }>();
            for await (const item of jsonLines(file)) {
                const id = item.conversationId;
                if (!isId(id)) continue;
                const updatedAt = when(item.timestamp) ?? 0;
                const display = clip(item.display);
                const prev = items.get(id);
                if (prev) {
                    prev.updatedAt = Math.max(prev.updatedAt, updatedAt);
                    if (prev.title.startsWith('/') && display && !display.startsWith('/')) prev.title = display;
                } else {
                    const cwd = pathFromWorkspace(item.workspace, project.distro);
                    if (cwd && display) items.set(id, { cwd, title: display, updatedAt });
                }
            }
            historyMap = { mtime: info.mtimeMs, size: info.size, items };
            this.agyHistoryCache.set(file, historyMap);
        }
        for (const [id, item] of historyMap?.items ?? []) {
            const existing = sessions.get(id);
            if (existing) {
                existing.updatedAt = Math.max(existing.updatedAt, item.updatedAt);
                if (!meta?.conversations?.[id] && existing.title.startsWith('/') && item.title && !item.title.startsWith('/')) {
                    existing.title = item.title;
                }
                continue;
            }
            if (meta?.conversations?.[id] || blockedIds.has(id) || knownOtherWorkspaceIds.has(id)) continue;
            if (!withinProject(item.cwd, project.directory, project.distro) || !item.title) continue;
            sessions.set(id, { id, cwd: item.cwd, title: item.title, executable: 'agy', args: ['--conversation', id], promptFile: file,
                wireFile: transcriptFor(id), updatedAt: item.updatedAt });
        }
        return [...sessions.values()];
    }

    private async kimi(project: Project, home: string): Promise<CliSession[]> {
        const readable = await localReadPath(home, project.distro);
        const meta = await readJson(win32.join(readable, 'kimi.json'));
        const results = new Map<string, CliSession>();
        const path = project.distro ? posix : win32;
        for await (const item of jsonLines(win32.join(readable, 'session_index.jsonl'))) {
            const { sessionId: id, sessionDir, workDir: cwd } = item;
            if (!isId(id) || typeof cwd !== 'string' || !withinProject(cwd, project.directory, project.distro)
                || typeof sessionDir !== 'string') continue;
            const directory = path.resolve(home, sessionDir);
            if (!withinProject(directory, path.join(home, 'sessions'), project.distro)) continue;
            const local = win32.join(readable, path.relative(home, directory));
            const stateFile = win32.join(local, 'state.json');
            const state = await readJson(stateFile);
            if (!state || state.archived) continue;
            const latestPrompt = typeof state.lastPrompt === 'string' ? state.lastPrompt.trim() : undefined;
            results.set(id, { id, cwd, title: clip(state.title) || clip(latestPrompt) || 'Kimi Code 会话',
                updatedAt: when(state.updatedAt) ?? (await stat(stateFile).catch(() => undefined))?.mtimeMs ?? 0,
                executable: 'kimi', args: ['--session', id], stateFile, wireFile: win32.join(local, 'agents', 'main', 'wire.jsonl') });
        }
        for (const entry of Array.isArray(meta?.work_dirs) ? meta.work_dirs : []) {
            const cwd = entry?.path;
            if (typeof cwd !== 'string' || !withinProject(cwd, project.directory, project.distro)) continue;
            const hash = createHash('md5').update(cwd).digest('hex');
            const directory = win32.join(readable, 'sessions', hash);
            for (const session of await children(directory)) {
                if (!session.isDirectory() || !isId(session.name)) continue;
                const context = win32.join(directory, session.name, 'context.jsonl');
                const state = await readJson(win32.join(directory, session.name, 'state.json'));
                if (state?.archived) continue;
                try {
                    const lines = (await sample(context)).map(json);
                    const title = clip(state?.custom_title) || clip(messageText(lines.find(item => item?.role === 'user')?.content));
                    if (!title) continue;
                    if (!results.has(session.name)) results.set(session.name, { id: session.name, cwd, title, updatedAt: (await stat(context)).mtimeMs,
                        executable: 'kimi', args: ['--session', session.name], promptFile: context, wireFile: win32.join(directory, session.name, 'wire.jsonl') });
                } catch { /* Empty or unavailable session. */ }
            }
        }
        return [...results.values()];
    }

    private async claude(project: Project, home: string): Promise<CliSession[]> {
        const path = project.distro ? posix : win32;
        const root = await localReadPath(path.join(home, 'projects'), project.distro);
        const normalize = (value: string) => project.distro ? value : value.toLowerCase();
        const prefix = normalize(project.directory.replace(/[^a-z0-9-]/gi, '-')).slice(0, 150);
        const matches: CliSession[] = [];
        for (const folder of await children(root)) {
            if (!folder.isDirectory() || !normalize(folder.name).startsWith(prefix)) continue;
            const directory = win32.join(root, folder.name);
            for (const file of await children(directory)) {
                const id = file.name.slice(0, -6);
                if (!file.isFile() || !file.name.endsWith('.jsonl') || !sessionIdPattern.test(id)) continue;
                const promptFile = win32.join(directory, file.name);
                const cached = this.sessionFileCache.get(promptFile);
                if (cached?.session && !withinProject(cached.session.cwd, project.directory, project.distro)) continue;
                try {
                    const info = await stat(promptFile);
                    if (cached && cached.mtime === info.mtimeMs) {
                        if (cached.session && withinProject(cached.session.cwd, project.directory, project.distro)) {
                            matches.push(cached.session);
                        }
                        continue;
                    }
                    const rows = (await sample(promptFile)).map(json);
                    const cwd = rows.find(row => row?.sessionId === id && typeof row.cwd === 'string' && !row.isSidechain)?.cwd;
                    if (!cwd) {
                        this.sessionFileCache.set(promptFile, { mtime: info.mtimeMs, session: null });
                        continue;
                    }
                    const first = rows.find(row => row?.type === 'user' && !row.isMeta && messageText(row.message?.content));
                    const title = clip(rows.find(row => row?.type === 'custom-title')?.customTitle)
                        || clip(messageText(first?.message?.content)) || 'Claude Code 会话';
                    const session: CliSession = { id, cwd, title, updatedAt: info.mtimeMs,
                        executable: 'claude', args: ['--resume', id], promptFile };
                    if (this.sessionFileCache.size >= 512) this.sessionFileCache.delete(this.sessionFileCache.keys().next().value!);
                    this.sessionFileCache.set(promptFile, { mtime: info.mtimeMs, session });
                    if (withinProject(cwd, project.directory, project.distro)) matches.push(session);
                } catch { /* A transcript can rotate during the scan. */ }
            }
        }
        return matches;
    }

    private async openCode(project: Project, limit: number): Promise<CliSession[]> {
        try {
            const original = await readCliOutput(project, { executable: 'opencode', args: ['session', 'list', '--format', 'json', '--max-count', String(Math.max(limit, 50))] });
            const start = original.indexOf('[');
            const rows: unknown = JSON.parse(start >= 0 ? original.slice(start) : original);
            return Array.isArray(rows) ? rows.flatMap(row => {
                const cwd = row?.directory ?? row?.cwd;
                if (!isId(row?.id) || typeof cwd !== 'string' || !withinProject(cwd, project.directory, project.distro)) return [];
                return [{ id: row.id, cwd, title: clip(row.title) || 'OpenCode 会话',
                    updatedAt: when(row.updated ?? row.updatedAt ?? row.time?.updated) ?? 0, executable: 'opencode',
                    args: ['--session', row.id], distro: project.distro } as CliSession];
            }) : [];
        } catch { return []; }
    }

    private async exportOpenCodeSession(project: Project, sessionId: string) {
        const args = ['session', 'export', sessionId];
        const raw = await readCliOutput(project, { executable: 'opencode', args })
            .catch(() => readCliOutput(project, { executable: 'opencode', args: args.slice(1) }));
        const start = raw.indexOf('{');
        return json(start >= 0 ? raw.slice(start) : raw);
    }

    private async readOpenCodeUsage(session: CliSession) {
        const cacheKey = `opencode:${session.distro ?? 'windows'}:${session.id}`;
        const cached = this.usageCache.get(cacheKey);
        if (cached && cached.mtime >= session.updatedAt && Date.now() - cached.size < 8000) return cached;
        try {
            const project: Project = { id: '', name: '', directory: session.cwd, distro: session.distro };
            const data = await this.exportOpenCodeSession(project, session.id);
            if (!data) return cached;
            const info = data.info;
            const entries: UsageEntry[] = [];
            let lastTurnTokens = 0;
            for (const msg of Array.isArray(data.messages) ? data.messages : []) {
                const isAssistant = msg?.type === 'assistant' || msg?.role === 'assistant' || msg?.info?.role === 'assistant';
                const tok = msg?.tokens ?? msg?.info?.tokens;
                if (!isAssistant || !tok) continue;
                const date = when(msg?.time?.completed ?? msg?.time?.created ?? msg?.info?.time?.completed ?? msg?.info?.time?.created) ?? session.updatedAt;
                const model = clip(msg?.model?.id ?? msg?.model ?? msg?.info?.modelID ?? info?.model?.id ?? info?.model) || 'opencode';
                const input = tokens(tok.input) + tokens(tok.cache?.write);
                const cachedRead = tokens(tok.cache?.read);
                const output = tokens(tok.output) + tokens(tok.reasoning);
                const turnTotal = input + cachedRead + output;
                if (turnTotal > 0) {
                    lastTurnTokens = turnTotal;
                    entries.push({ date, model, input, cached: cachedRead, output });
                }
            }
            if (!entries.length && info?.tokens) {
                const tok = info.tokens;
                const input = tokens(tok.input) + tokens(tok.cache?.write);
                const cachedRead = tokens(tok.cache?.read);
                const output = tokens(tok.output) + tokens(tok.reasoning);
                if (input + cachedRead + output > 0) {
                    lastTurnTokens = input + cachedRead + output;
                    entries.push({
                        date: when(info.time?.updated ?? info.time?.created) ?? session.updatedAt,
                        model: clip(info.model?.id ?? info.model) || 'opencode',
                        input, cached: cachedRead, output,
                    });
                }
            }
            const model = clip(info?.model?.id ?? info?.model) || entries.at(-1)?.model || undefined;
            const effort = clip(info?.model?.variant) || undefined;
            const totalTokens = entries.length ? entries.reduce((sum, item) => sum + item.input + item.cached + item.output, 0) : undefined;
            const detail: SessionDetails = {
                model: model === 'opencode' ? undefined : model,
                effort,
                tokens: totalTokens,
                hasError: (info?.outcome === 'failed' || info?.outcome === 'error')
                    && !isAbortMessage(info?.error?.name ?? info?.error?.message),
            };
            if (lastTurnTokens > 0) {
                const window = inferContextWindow(detail.model);
                const percent = window ? Math.min(100, Math.max(0, (lastTurnTokens / window) * 100)) : undefined;
                detail.context = { tokens: lastTurnTokens, window, percent };
            }
            const result = { mtime: session.updatedAt, size: Date.now(), entries: entries.sort((a, b) => a.date - b.date), detail };
            if (this.usageCache.size >= 256) this.usageCache.delete(this.usageCache.keys().next().value!);
            this.usageCache.set(cacheKey, result);
            return result;
        } catch {
            return cached;
        }
    }

    private async grok(project: Project, home: string): Promise<CliSession[]> {
        const path = project.distro ? posix : win32;
        const root = await localReadPath(path.join(home, 'sessions'), project.distro);
        const results: CliSession[] = [];
        for (const folder of await children(root)) {
            if (!folder.isDirectory()) continue;
            const groupDir = win32.join(root, folder.name);
            let groupCwd = '';
            try { groupCwd = decodeURIComponent(folder.name); } catch { /* Hash fallback uses .cwd or summary.json */ }
            if (!groupCwd || !groupCwd.startsWith('/') && !/^[a-z]:/i.test(groupCwd)) {
                groupCwd = (await readFile(win32.join(groupDir, '.cwd'), 'utf8').catch(() => '')).trim();
            }
            if (groupCwd && !withinProject(groupCwd, project.directory, project.distro)) continue;
            const promptHistory = win32.join(groupDir, 'prompt_history.jsonl');
            const hasPromptHistory = Boolean(await stat(promptHistory).catch(() => undefined));
            for (const entry of await children(groupDir)) {
                if (!entry.isDirectory() || !isId(entry.name)) continue;
                const sessionDir = win32.join(groupDir, entry.name);
                const summaryFile = win32.join(sessionDir, 'summary.json');
                const summary = await readJson(summaryFile);
                if (!summary) continue;
                const cwd = typeof summary.info?.cwd === 'string' ? summary.info.cwd : groupCwd;
                if (!cwd || !withinProject(cwd, project.directory, project.distro)) continue;
                const numMessages = typeof summary.num_messages === 'number' ? summary.num_messages : 0;
                const title = clip(summary.session_summary) || clip(summary.generated_title) || clip(summary.last_turn_summary);
                if (!title && numMessages === 0) continue;
                const updatedAt = when(summary.last_active_at ?? summary.updated_at ?? summary.created_at)
                    ?? (await stat(summaryFile).catch(() => undefined))?.mtimeMs ?? 0;
                const updatesFile = win32.join(sessionDir, 'updates.jsonl');
                const hasUpdates = Boolean(await stat(updatesFile).catch(() => undefined));
                results.push({
                    id: entry.name,
                    cwd,
                    title: title || 'Grok Build 会话',
                    updatedAt,
                    executable: 'grok',
                    args: ['--resume', entry.name],
                    promptFile: hasUpdates ? updatesFile : (hasPromptHistory ? promptHistory : undefined),
                    wireFile: win32.join(sessionDir, 'usage.json'),
                    stateFile: summaryFile,
                });
            }
        }
        return results;
    }

    private async readGrokUsage(session: CliSession) {
        const file = session.wireFile;
        const summaryFile = session.stateFile;
        const signalsFile = summaryFile ? win32.join(win32.dirname(summaryFile), 'signals.json') : undefined;
        const [fileInfo, summaryInfo, signalsInfo] = await Promise.all([
            file ? stat(file).catch(() => undefined) : undefined,
            summaryFile ? stat(summaryFile).catch(() => undefined) : undefined,
            signalsFile ? stat(signalsFile).catch(() => undefined) : undefined,
        ]);
        const infos = [fileInfo, summaryInfo, signalsInfo].filter((item): item is NonNullable<typeof fileInfo> => Boolean(item));
        if (!infos.length) return;
        const mtime = Math.max(...infos.map(item => item.mtimeMs));
        const size = infos.reduce((sum, item) => sum + item.size, 0);
        const cacheKey = file ?? summaryFile!;
        const cached = this.usageCache.get(cacheKey);
        if (cached?.mtime === mtime && cached.size === size) return cached;
        const [data, summary, signals] = await Promise.all([
            file ? readJson(file) : undefined,
            summaryFile ? readJson(summaryFile) : undefined,
            signalsFile ? readJson(signalsFile) : undefined,
        ]);
        const entries: UsageEntry[] = [];
        const addModelUsage = (date: number, modelUsage: Record<string, any> | undefined, fallbackOwner?: any) => {
            if (modelUsage && typeof modelUsage === 'object' && Object.keys(modelUsage).length) {
                for (const [modelName, item] of Object.entries(modelUsage)) {
                    const cachedRead = tokens(item?.cachedReadTokens);
                    const rawInput = tokens(item?.inputTokens) + tokens(item?.cacheCreationTokens);
                    const input = rawInput >= cachedRead ? rawInput - cachedRead : rawInput;
                    const output = tokens(item?.outputTokens);
                    if (input + cachedRead + output > 0) {
                        entries.push({ date, model: clip(modelName) || 'grok', input, cached: cachedRead, output });
                    }
                }
                return;
            }
            if (fallbackOwner) {
                const cachedRead = tokens(fallbackOwner.cachedReadTokens);
                const rawInput = tokens(fallbackOwner.inputTokens) + tokens(fallbackOwner.cacheCreationTokens);
                const input = rawInput >= cachedRead ? rawInput - cachedRead : rawInput;
                const output = tokens(fallbackOwner.outputTokens);
                if (input + cachedRead + output > 0) {
                    entries.push({ date, model: clip(fallbackOwner.primaryModelId ?? summary?.current_model_id) || 'grok', input, cached: cachedRead, output });
                }
            }
        };
        if (Array.isArray(data?.turns) && data.turns.length) {
            for (const turn of data.turns) {
                const date = when(turn?.endedAt ?? data?.updatedAt) ?? session.updatedAt;
                addModelUsage(date, turn?.modelUsage, turn);
            }
        } else if (data?.session) {
            const date = when(data.updatedAt) ?? session.updatedAt;
            addModelUsage(date, data.session.modelUsage, data.session);
        }
        const detail: SessionDetails = {
            model: clip(summary?.current_model_id ?? data?.session?.primaryModelId ?? signals?.primaryModelId) || undefined,
            effort: clip(summary?.reasoning_effort) || undefined,
            tokens: entries.length ? entries.reduce((sum, item) => sum + item.input + item.cached + item.output, 0) : undefined,
            hasError: summary?.status === 'cancelled' || summary?.status === 'aborted'
                ? false
                : Boolean(summary?.status === 'error' || (summary?.last_error && !isAbortMessage(summary.last_error)) || signals?.hasError),
        };
        const rawPct = typeof signals?.contextWindowUsage === 'number' && Number.isFinite(signals.contextWindowUsage)
            ? signals.contextWindowUsage : undefined;
        const lastEntry = entries.at(-1);
        const lastTurnTokens = lastEntry ? lastEntry.input + lastEntry.cached + lastEntry.output : 0;
        const ctxTokens = tokens(signals?.contextTokensUsed) || lastTurnTokens || undefined;
        const ctxWindow = tokens(signals?.contextWindowTokens ?? summary?.context_window) || inferContextWindow(detail.model);
        const ctxPct = rawPct !== undefined
            ? (rawPct > 0 && rawPct <= 1 && (!ctxTokens || !ctxWindow || Math.abs(rawPct - ctxTokens / ctxWindow) < 0.05) ? rawPct * 100 : rawPct)
            : (ctxTokens && ctxWindow ? Math.min(100, Math.max(0, (ctxTokens / ctxWindow) * 100)) : undefined);
        if (ctxPct !== undefined || ctxTokens !== undefined) {
            detail.context = { percent: ctxPct, tokens: ctxTokens, window: ctxWindow };
        }
        const result = { mtime, size, entries: entries.sort((a, b) => a.date - b.date), detail };
        if (this.usageCache.size >= 256) this.usageCache.delete(this.usageCache.keys().next().value!);
        this.usageCache.set(cacheKey, result);
        return result;
    }

    private parseSimpleYaml(text: string): Record<string, string> {
        const record: Record<string, string> = {};
        for (const rawLine of text.split(/\r?\n/)) {
            const match = /^([a-zA-Z0-9_]+):\s*(.+?)\s*$/.exec(rawLine);
            if (!match) continue;
            let value = match[2];
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            record[match[1]] = value;
        }
        return record;
    }

    private async copilot(project: Project, home: string): Promise<CliSession[]> {
        const path = project.distro ? posix : win32;
        const root = await localReadPath(path.join(home, 'session-state'), project.distro);
        const results: CliSession[] = [];
        let inspected = 0;
        for (const folder of await children(root)) {
            if (!folder.isDirectory() || !isId(folder.name)) continue;
            if (++inspected % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
            const sessionDir = win32.join(root, folder.name);
            const workspaceFile = win32.join(sessionDir, 'workspace.yaml');
            const eventsFile = win32.join(sessionDir, 'events.jsonl');
            const [wsInfo, evInfo] = await Promise.all([
                stat(workspaceFile).catch(() => undefined),
                stat(eventsFile).catch(() => undefined),
            ]);
            if (!wsInfo && !evInfo) continue;
            const cacheKey = eventsFile;
            const mtime = Math.max(wsInfo?.mtimeMs ?? 0, evInfo?.mtimeMs ?? 0);
            const cached = this.sessionFileCache.get(cacheKey);
            let session: CliSession | null | undefined = cached?.mtime === mtime ? cached.session : undefined;
            if (session === undefined) {
                const ws = wsInfo ? this.parseSimpleYaml(await readFile(workspaceFile, 'utf8').catch(() => '')) : {};
                let cwd = typeof ws.cwd === 'string' ? ws.cwd : '';
                let title = clip(ws.summary);
                let updatedAt = when(ws.updated_at ?? ws.created_at) ?? 0;
                if (evInfo && (!cwd || !title)) {
                    for (const line of await sample(eventsFile).catch(() => [])) {
                        const item = json(line);
                        if (!item) continue;
                        const ts = when(item.timestamp);
                        if (ts && ts > updatedAt) updatedAt = ts;
                        if (item.type === 'session.start' && !cwd && typeof item.data?.context?.cwd === 'string') {
                            cwd = item.data.context.cwd;
                        }
                        if (item.type === 'user.message' && !title) {
                            title = clip(messageText(item.data?.content ?? item.data?.prompt ?? item.content));
                        }
                    }
                }
                const sessionId = clip(ws.id) || folder.name;
                session = cwd && (title || evInfo) ? {
                    id: sessionId,
                    cwd,
                    title: title || t('GitHub Copilot 会话', 'GitHub Copilot Session'),
                    updatedAt: updatedAt || evInfo?.mtimeMs || wsInfo?.mtimeMs || 0,
                    executable: 'copilot',
                    args: ['--resume', sessionId],
                    promptFile: evInfo ? eventsFile : undefined,
                    stateFile: wsInfo ? workspaceFile : undefined,
                } : null;
                if (this.sessionFileCache.size >= 512) this.sessionFileCache.delete(this.sessionFileCache.keys().next().value!);
                this.sessionFileCache.set(cacheKey, { mtime, session });
            }
            if (session && withinProject(session.cwd, project.directory, project.distro)) {
                results.push(session);
            }
        }
        return results;
    }

    private async readCopilotUsage(session: CliSession) {
        const file = session.promptFile;
        if (!file) return;
        const info = await stat(file).catch(() => undefined);
        if (!info) return;
        const cached = this.usageCache.get(file);
        if (cached?.mtime === info.mtimeMs && cached.size === info.size) return cached;
        const entries: UsageEntry[] = [];
        const fallbackEntries: UsageEntry[] = [];
        const detail: SessionDetails = {};
        let lastTurnTokens = 0;
        let lastUsageInfo: { tokens?: number; window?: number; percent?: number } | undefined;

        for await (const item of jsonLines(file)) {
            const data = item.data;
            const date = when(item.timestamp) ?? session.updatedAt;
            if (item.type === 'session.start') {
                const selected = clip(data?.selectedModel ?? data?.model);
                if (selected) detail.model = selected;
            } else if (item.type === 'session.model_change') {
                const next = clip(data?.newModel ?? data?.selectedModel ?? data?.model);
                if (next) detail.model = next;
            } else if (item.type === 'user.message' || item.type === 'assistant.turn_start') {
                detail.hasError = false;
            } else if (item.type === 'session.error' || item.type === 'error') {
                detail.hasError = !(data?.errorType === 'abort' || data?.errorType === 'cancelled' || isAbortMessage(data?.message));
            } else if (item.type === 'session.usage_info' && data) {
                const used = tokens(data.currentTokens);
                const limit = tokens(data.tokenLimit) || inferContextWindow(detail.model);
                if (used > 0 || limit) {
                    const percent = limit && limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : undefined;
                    lastUsageInfo = { tokens: used || undefined, window: limit || undefined, percent };
                }
            } else if (item.type === 'assistant.usage' && data) {
                const model = clip(data.model) || detail.model || 'copilot';
                if (model !== 'copilot') detail.model = model;
                const cachedRead = tokens(data.cacheReadTokens ?? data.cache_read_tokens);
                const cacheWrite = tokens(data.cacheWriteTokens ?? data.cache_write_tokens);
                const rawInput = tokens(data.inputTokens ?? data.input_tokens);
                const uncachedInput = rawInput >= cachedRead ? rawInput - cachedRead : rawInput;
                const input = uncachedInput + (rawInput >= cacheWrite ? 0 : cacheWrite);
                const output = tokens(data.outputTokens ?? data.output_tokens);
                const turnTotal = input + cachedRead + output;
                if (turnTotal > 0) {
                    lastTurnTokens = turnTotal;
                    entries.push({ date, model, input, cached: cachedRead, output });
                }
            } else if (item.type === 'session.shutdown' && data) {
                const currentModel = clip(data.currentModel);
                if (currentModel) detail.model = currentModel;
                if (data.modelMetrics && typeof data.modelMetrics === 'object') {
                    for (const [modelName, metric] of Object.entries<any>(data.modelMetrics)) {
                        const u = metric?.usage ?? metric;
                        if (!u) continue;
                        const cachedRead = tokens(u.cacheReadTokens ?? u.cache_read_tokens);
                        const cacheWrite = tokens(u.cacheWriteTokens ?? u.cache_write_tokens);
                        const rawInput = tokens(u.inputTokens ?? u.input_tokens);
                        const uncachedInput = rawInput >= cachedRead ? rawInput - cachedRead : rawInput;
                        const input = uncachedInput + (rawInput >= cacheWrite ? 0 : cacheWrite);
                        const output = tokens(u.outputTokens ?? u.output_tokens);
                        if (input + cachedRead + output > 0) {
                            fallbackEntries.push({ date, model: clip(modelName) || detail.model || 'copilot', input, cached: cachedRead, output });
                        }
                    }
                }
            }
        }
        const finalEntries = (entries.length ? entries : fallbackEntries).sort((a, b) => a.date - b.date);
        if (!detail.model && finalEntries.length) {
            const lastModel = finalEntries[finalEntries.length - 1].model;
            if (lastModel && lastModel !== 'copilot') detail.model = lastModel;
        }
        detail.tokens = finalEntries.length ? finalEntries.reduce((sum, item) => sum + item.input + item.cached + item.output, 0) : undefined;
        if (lastUsageInfo) {
            detail.context = lastUsageInfo;
        } else if (lastTurnTokens > 0) {
            const window = inferContextWindow(detail.model);
            const percent = window ? Math.min(100, Math.max(0, (lastTurnTokens / window) * 100)) : undefined;
            detail.context = { tokens: lastTurnTokens, window, percent };
        }
        const result = { mtime: info.mtimeMs, size: info.size, entries: finalEntries, detail };
        if (this.usageCache.size >= 256) this.usageCache.delete(this.usageCache.keys().next().value!);
        this.usageCache.set(file, result);
        return result;
    }
}
