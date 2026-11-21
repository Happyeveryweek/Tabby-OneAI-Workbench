import { createReadStream } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import * as zlib from 'node:zlib';

// Codex rollout fields and token accounting follow OneAI's session and usage readers.
// See THIRD_PARTY_NOTICES.md.
type Json = Record<string, any>;

export interface CodexSession {
    id: string;
    cwd: string;
    title: string;
    updatedAt: number;
    file?: string;
    model?: string;
    effort?: string;
}

export interface QuotaWindow {
    remaining: number;
    resetsAt?: number;
}

export interface Quota {
    fiveHour?: QuotaWindow;
    weekly?: QuotaWindow;
    updatedAt: number;
    source: 'local' | 'codex' | 'agy' | 'claude';
}

export interface SessionDetails {
    updatedAt?: number;
    summary?: string;
    model?: string;
    effort?: string;
    tokens?: number;
    quota?: Quota;
    localUsage?: boolean;
    hasError?: boolean;
    context?: { tokens?: number; window?: number; percent?: number };
}

export interface SessionPrompt { text: string; at?: number; }

const abortTextPattern = /^(?:(?:[│┃▌⎿✖✗×!●•]\s*)*(?:error|api\s*error)\s*[:：]\s*)?(?:\[?\s*(?:operation\s+aborted|request\s+(?:was\s+)?aborted|request\s+interrupted(?:\s+by\s+user(?:\s+for\s+tool\s+use)?)?|interrupted(?:\s+by\s+user)?|user\s+(?:aborted|cancell?ed|interrupted)|(?:turn|execution|stream)\s+(?:aborted|cancell?ed|interrupted)|cancell?ed(?:\s+by\s+user)?|aborted(?:\s+by\s+user)?|aborted|client\s+cancelled|messageabortederror|aborterror)\s*\]?)(?:[.!。]|$)/i;

export function isAbortMessage(value: unknown): boolean {
    return typeof value === 'string' && abortTextPattern.test(value.trim());
}
export interface UsageEntry {
    date: number;
    model: string;
    input: number;
    cached: number;
    output: number;
}

export interface UsageRow {
    model: string;
    requests: number;
    sessions: number;
    input: number;
    cached: number;
    output: number;
}

export interface UsageDay { date: string; requests: number; }
export interface UsageReport { rows: UsageRow[]; days: UsageDay[]; }

export const sessionIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
export const clip = (value: unknown): string => string(value).replace(/\s+/g, ' ').trim().slice(0, 120);

export function codexPrompt(value: unknown): string {
    let text = string(value).trim();
    const prefix = /^(?:<(recommended_plugins|environment_context|permissions instructions|collaboration_mode|skills_instructions)>[\s\S]*?<\/\1>|# AGENTS\.md instructions for [^\r\n]+\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>)\s*/i;
    let size;
    do {
        size = text.length;
        text = text.replace(prefix, '');
    } while (text.length !== size);
    return text;
}

export function json(line: string): Json | undefined {
    try {
        const value: unknown = JSON.parse(line);
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
    } catch { return undefined; }
}

function userText(event: Json): string {
    if (event.type === 'event_msg' && event.payload?.type === 'user_message') return codexPrompt(event.payload.message);
    if (event.type !== 'response_item' || event.payload?.type !== 'message' || event.payload?.role !== 'user') return '';
    const content = event.payload.content;
    const text = Array.isArray(content) ? content.filter(item => item?.type === 'input_text').map(item => string(item.text)).join(' ') : '';
    return codexPrompt(text);
}

export async function* jsonLines(file: string): AsyncGenerator<Json> {
    const reader = createReadStream(file);
    const input = file.endsWith('.zst') && zlib.createZstdDecompress ? reader.pipe(zlib.createZstdDecompress()) : reader;
    if (input !== reader) reader.on('error', error => input.destroy(error));
    try {
        for await (const line of createInterface({ input, crlfDelay: Infinity })) {
            const record = json(line);
            if (record) yield record;
        }
    } catch { /* The file may have been removed or rotated. */ }
    finally { reader.destroy(); }
}

export async function localPrompts(file: string): Promise<SessionPrompt[]> {
    const prompts: SessionPrompt[] = [];
    const messages: SessionPrompt[] = [];
    for await (const event of jsonLines(file)) {
        const text = userText(event);
        if (!text) continue;
        const at = Date.parse(event.timestamp);
        (event.type === 'event_msg' ? prompts : messages).push({ text, at: Number.isFinite(at) ? at : undefined });
    }
    return prompts.length ? prompts : messages;
}

async function readSlice(file: string, bytes: number, tail = false): Promise<string[]> {
    const handle = await open(file, 'r');
    try {
        const size = (await handle.stat()).size;
        const buffer = Buffer.alloc(Math.min(size, bytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, tail ? size - buffer.length : 0);
        const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
        if (tail && size > buffer.length) lines.shift();
        return lines;
    } finally { await handle.close(); }
}

async function filesIn(directory: string, depth: number, limit = Infinity): Promise<string[]> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
    const matches = entries.filter(item => item.isFile() && /^rollout-.+\.jsonl(?:\.zst)?$/i.test(item.name))
        .map(item => join(directory, item.name)).sort().reverse();
    if (!depth) return matches.slice(0, limit);
    const folders = entries.filter(item => item.isDirectory() && /^\d+$/.test(item.name)).map(item => item.name).sort().reverse();
    for (const folder of folders) {
        if (matches.length >= limit) break;
        matches.push(...await filesIn(join(directory, folder), depth - 1, limit - matches.length));
    }
    return matches.slice(0, limit);
}

export async function findRollout(home: string, id: string): Promise<string | undefined> {
    if (!sessionIdPattern.test(id)) return;
    const suffix = `-${id.toLowerCase()}.jsonl`;
    for (const name of ['sessions', 'archived_sessions']) {
        const match = (await filesIn(join(home, name), 4)).find(file => file.toLowerCase().endsWith(suffix) || file.toLowerCase().endsWith(suffix + '.zst'));
        if (match) return match;
    }
}

async function titlesAt(home: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
        for (const line of (await readFile(join(home, 'session_index.jsonl'), 'utf8')).split('\n')) {
            const entry = json(line);
            if (entry && sessionIdPattern.test(string(entry.id)) && clip(entry.thread_name)) result.set(entry.id, clip(entry.thread_name));
        }
    } catch { /* Older Codex has no title index. */ }
    return result;
}

const rolloutMetaCache = new Map<string, { id: string; cwd: string; firstPrompt?: string; mtimeMs: number } | null>();

export async function localHistory(home: string, limit = 200, acceptsDirectory?: (cwd: string) => boolean): Promise<CodexSession[]> {
    const maxFiles = Math.min(Math.max(limit * 3, 36), 96);
    const [files, titles] = await Promise.all([filesIn(join(home, 'sessions'), 4, maxFiles), titlesAt(home)]);
    const sessions = new Map<string, CodexSession>();
    let scanned = 0;
    for (const file of files) {
        if (file.endsWith('.zst')) continue;
        const cached = rolloutMetaCache.get(file);
        if (cached === null) continue;
        if (cached && acceptsDirectory && !acceptsDirectory(cached.cwd)) continue;
        if (++scanned % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        try {
            let metaEntry = cached;
            if (!metaEntry) {
                const rawLines = await readSlice(file, 24 * 1024);
                const first = json(rawLines[0] ?? '');
                const meta = (first?.type === 'session_meta' ? first : rawLines.slice(0, 6).map(json).find(line => line?.type === 'session_meta'))?.payload;
                const id = string(meta?.id);
                const cwd = string(meta?.cwd);
                if (!sessionIdPattern.test(id) || !cwd || (meta.source && typeof meta.source !== 'string')) {
                    rolloutMetaCache.set(file, null);
                    continue;
                }
                let firstPrompt: string | undefined;
                for (const raw of rawLines) {
                    const parsed = json(raw);
                    const text = parsed && userText(parsed);
                    if (text) { firstPrompt = clip(text); break; }
                }
                const { mtimeMs } = await stat(file);
                metaEntry = { id, cwd, firstPrompt, mtimeMs };
                if (rolloutMetaCache.size >= 512) rolloutMetaCache.delete(rolloutMetaCache.keys().next().value!);
                rolloutMetaCache.set(file, metaEntry);
            } else {
                const info = await stat(file).catch(() => undefined);
                if (info) metaEntry.mtimeMs = info.mtimeMs;
            }
            if (acceptsDirectory && !acceptsDirectory(metaEntry.cwd)) continue;
            const title = titles.get(metaEntry.id) || metaEntry.firstPrompt || metaEntry.cwd.split(/[\\/]/).filter(Boolean).pop() || 'Codex 会话';
            const previous = sessions.get(metaEntry.id);
            if (!previous || previous.updatedAt < metaEntry.mtimeMs) {
                sessions.set(metaEntry.id, { id: metaEntry.id, cwd: metaEntry.cwd, title, updatedAt: metaEntry.mtimeMs, file });
            }
            if (acceptsDirectory && sessions.size >= limit) break;
        } catch { /* A rotation may remove a file during a refresh. */ }
    }
    return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function quotaFrom(snapshot: Json | undefined, updatedAt: number, source: Quota['source']): Quota | undefined {
    if (!snapshot || !updatedAt || !Number.isFinite(updatedAt)) return;
    const bucket = snapshot.limitId ?? snapshot.limit_id;
    if (bucket && bucket !== 'codex') return;
    const quota: Quota = { updatedAt, source };
    for (const window of [snapshot.primary, snapshot.secondary]) {
        const used = window?.usedPercent ?? window?.used_percent;
        if (typeof used !== 'number' || !Number.isFinite(used)) continue;
        const duration = window.windowDurationMins ?? window.windowMinutes ?? window.window_minutes;
        const reset = window.resetsAt ?? window.resets_at;
        const value = { remaining: Math.round(Math.min(100, Math.max(0, 100 - used))), resetsAt: typeof reset === 'number' && reset > 0 ? reset * 1000 : undefined };
        if (duration === 300) quota.fiveHour = value;
        if (duration === 10080) quota.weekly = value;
    }
    return quota.fiveHour || quota.weekly ? quota : undefined;
}

export async function localDetails(file: string): Promise<SessionDetails> {
    const result: SessionDetails = {};
    try {
        for (const text of await readSlice(file, 512 * 1024, true)) {
            const line = json(text);
            if (!line) continue;
            const at = Date.parse(line.timestamp);
            if (Number.isFinite(at)) result.updatedAt = Math.max(result.updatedAt ?? 0, at);
            const message = userText(line);
            if (message) result.summary = clip(message);
            const data = line.payload;
            if (line.type === 'turn_context') {
                result.model = string(data?.model) || result.model;
                result.effort = string(data?.effort) || result.effort;
            }
            if (line.type === 'error' || (line.type === 'event_msg' && (data?.type === 'error' || (data?.type === 'turn_aborted' && data?.reason === 'error')))) {
                result.hasError = !isAbortMessage(data?.message ?? line.message);
            } else if (line.type === 'response_item' || (line.type === 'event_msg' && (data?.type === 'user_message' || data?.type === 'task_started' || data?.type === 'agent_message' || data?.type === 'task_complete' || data?.type === 'turn_aborted'))) {
                result.hasError = false;
            }
            if (line.type === 'event_msg' && data?.type === 'token_count') {
                const active = data.info?.last_token_usage?.total_tokens;
                const size = data.info?.model_context_window;
                if (typeof active === 'number' && Number.isFinite(active) && active >= 0) {
                    const window = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : undefined;
                    const baseline = 12000;
                    const percent = window && (window <= baseline ? 100 : Math.round(Math.min(1, Math.max(0, (active - baseline) / (window - baseline))) * 100));
                    result.context = { tokens: active, window, percent };
                }
                const tokens = data.info?.total_token_usage?.total_tokens;
                if (typeof tokens === 'number' && Number.isFinite(tokens)) {
                    result.tokens = tokens;
                    result.localUsage = true;
                }
                result.quota = quotaFrom(data.rate_limits, Date.parse(line.timestamp), 'local') ?? result.quota;
            }
        }
    } catch { /* Missing or temporarily unreadable rollout. */ }
    return result;
}

export async function localQuota(home: string): Promise<Quota | undefined> {
    const files = (await filesIn(join(home, 'sessions'), 4, 12)).filter(file => !file.endsWith('.zst'));
    const snapshots = await Promise.all(files.map(localDetails));
    return snapshots.map(item => item.quota).filter((item): item is Quota => Boolean(item)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export class LocalUsage {
    private cache = new Map<string, { mtime: number; size: number; session: string; entries: UsageEntry[] }>();

    async session(file: string): Promise<UsageEntry[]> {
        return (await this.load(file, 0))?.entries ?? [];
    }

    async report(home: string, now = new Date()): Promise<UsageReport> {
        const week = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        week.setDate(week.getDate() - (week.getDay() + 6) % 7);
        const start = new Date(week);
        start.setDate(start.getDate() - 25 * 7);
        const days = new Map<string, UsageDay>();
        for (const day = new Date(start); +day <= +now; day.setDate(day.getDate() + 1)) {
            const date = this.dateKey(day);
            days.set(date, { date, requests: 0 });
        }
        const files = (await Promise.all([filesIn(join(home, 'sessions'), 4), filesIn(join(home, 'archived_sessions'), 1)])).flat();
        const rows = new Map<string, UsageRow>();
        const sessions = new Set<string>();
        for (const file of files) {
            const item = await this.load(file, +start);
            if (!item || sessions.has(item.session)) continue;
            sessions.add(item.session);
            const counted = new Set<string>();
            for (const entry of item.entries) {
                const day = days.get(this.dateKey(new Date(entry.date)));
                if (!day || entry.date > +now) continue;
                day.requests += 1;
                if (entry.date < +week) continue;
                const row = rows.get(entry.model) ?? { model: entry.model, requests: 0, sessions: 0, input: 0, output: 0, cached: 0 };
                if (!counted.has(entry.model)) row.sessions += 1;
                counted.add(entry.model);
                row.requests += 1;
                row.input += entry.input;
                row.output += entry.output;
                row.cached += entry.cached;
                rows.set(entry.model, row);
            }
        }
        return { rows: [...rows.values()].sort((a, b) => b.input + b.output + b.cached - a.input - a.output - a.cached), days: [...days.values()] };
    }

    private dateKey(date: Date): string {
        return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(value => String(value).padStart(2, '0')).join('-');
    }

    private async load(file: string, start: number) {
        try {
            const { mtimeMs, size } = await stat(file);
            if (mtimeMs < start) return;
            const cached = this.cache.get(file);
            if (cached?.mtime === mtimeMs && cached.size === size) return cached;
            let model = '未知模型';
            let session = file.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?=\.jsonl)/i)?.[0] ?? file;
            let lastTotal = -1;
            const entries: UsageEntry[] = [];
            if (file.endsWith('.zst') && !zlib.createZstdDecompress) return;
            const reader = createReadStream(file);
            const input = file.endsWith('.zst') ? reader.pipe(zlib.createZstdDecompress()) : reader;
            if (input !== reader) reader.on('error', error => input.destroy(error));
            try {
                for await (const text of createInterface({ input, crlfDelay: Infinity })) {
                    const event = json(text);
                    if (!event) continue;
                    const payload = event.payload;
                    if (event.type === 'session_meta' && sessionIdPattern.test(string(payload?.id))) session = payload.id;
                    if (event.type === 'turn_context' && string(payload?.model)) model = payload.model;
                    if (event.type !== 'event_msg' || payload?.type !== 'token_count') continue;
                    const totals = payload.info?.total_token_usage?.total_tokens;
                    const usage = payload.info?.last_token_usage;
                    const date = Date.parse(event.timestamp);
                    if (!usage || !Number.isFinite(totals) || totals === lastTotal || !Number.isFinite(date)) continue;
                    lastTotal = totals;
                    const input = number(usage.input_tokens);
                    const cached = Math.min(input, number(usage.cached_input_tokens));
                    entries.push({ date, model, input: input - cached, cached, output: number(usage.output_tokens) });
                }
            } finally { reader.destroy(); }
            const result = { mtime: mtimeMs, size, session, entries };
            this.cache.set(file, result);
            if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value!);
            return result;
        } catch { return undefined; }
    }
}
