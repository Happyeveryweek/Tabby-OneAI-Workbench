import { Inject, Injectable, NgZone, OnDestroy } from '@angular/core';
import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { Subscription } from 'rxjs';
import { cliBrand, cliIcon, supportedCli } from './cli-icons';
import { AppService, PlatformService, ProfilesService } from './host';
import type { App, Platform, Profiles, Tab, TerminalScreen } from './host';
import { checkDirectory, commandFor, detect, detectAvailableCli, gitBranch, localReadPath, profileFor, profilePrefix, projectLocation, resolveProjectLocation } from './commands';
import type { Command, Project } from './commands';
import { CodexService, codexTerminalTitle, codexTitleOption, defaultAccount, equalPath, isCodex, withinProject } from './codex';
import type { CodexActivity, CodexScope, HistoryEntry } from './codex';
import type { SessionDetails } from './codex-data';
import { isAbortMessage } from './codex-data';
import { CliHistory } from './cli-history';
import type { CliSession } from './cli-history';
import { extractMeterSettingsArg, prepareAgyMeter, recoverAgyMeter, watchAgyMeterFile } from './agy-meter';
import type { AgyStatus } from './agy-status';
import { CliDirectories, configurableCli, directoryVariables } from './cli-directories';
import { WorkbenchI18n } from './i18n';

type TaskStatus = 'starting' | 'running' | 'stopped' | 'failed';
type StatusDisplay = TaskStatus | CodexActivity | 'online';
const statusLabels: Record<StatusDisplay, string> = {
    starting: 'Starting', running: 'Running', working: 'Running', ready: 'Ready', waiting: 'Waiting',
    online: 'Online', error: 'Error', stopped: 'Exited', failed: 'Failed',
};
const statusColors: Record<StatusDisplay, string> = {
    starting: '#cf920c', running: '#20b782', working: '#20b782', ready: '#5a9de1', waiting: '#cf920c',
    online: '#5a9de1', error: '#e26070', stopped: '#808893', failed: '#e26070',
};

interface TaskRecord extends Command {
    id: string;
    projectId: string;
    name: string;
    directory?: string;
    codex?: { accountId: string; sessionId?: string };
    cliSession?: HistoryEntry['cli'];
    dataDirectory?: string;
    lastActiveAt?: number;
}

export interface Task extends TaskRecord {
    status: TaskStatus;
    activity?: CodexActivity;
    unread: boolean;
    error?: string;
    detail?: SessionDetails;
    refreshing?: boolean;
    refreshMessage?: string;
    startedAt?: number;
}

export function isTaskActiveExecution(task: Task): boolean {
    const state = statusDisplay(task);
    return state === 'working' || state === 'waiting' || state === 'starting';
}

export function statusDisplay(task: Task): StatusDisplay {
    return task.status === 'running' ? task.activity ?? 'online' : task.status;
}

export function taskStatusLabel(task: Task): string { return statusLabels[statusDisplay(task)]; }

export function isTrackedAiTask(task: Pick<Task, 'executable' | 'codex' | 'cliSession'>): boolean {
    if (task.codex || task.cliSession) return true;
    const exec = cliBrand(task.executable)?.executable;
    return Boolean(exec && supportedCli.some(item => item.executable === exec));
}

/** Strip terminal escape sequences while keeping printable characters and line breaks. */
export function stripTerminalEscapes(chunk: string): string {
    return chunk
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b[PX^_][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x9b[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b[@-Z\\-_]/g, '');
}

/** Strip terminal escape and control sequences to check for printable output. */
export function hasVisibleTerminalText(chunk: string): boolean {
    const plain = stripTerminalEscapes(chunk).replace(/[\x00-\x1f\x7f]/g, '');
    return /\S/.test(plain);
}

/** Check whether an interactive CLI update prompt currently has "Update now" selected on screen. */
export function screenHasSelectedUpdateNow(screen?: TerminalScreen): boolean {
    if (!screen?.buffer?.active) return false;
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 14);
    const lines = Array.from({ length: Math.min(20, bottom + 1) }, (_, offset) =>
        buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '').filter(Boolean);
    if (!lines.length) return false;
    const hasUpdateBanner = lines.some(line =>
        /\b(?:Update\s+available|New\s+version\s+[\w.-]+\s+is\s+available|A\s+new\s+version\s+of\b.*\bis\s+available)\b/i.test(line));
    if (!hasUpdateBanner) return false;
    if (lines.some(line => /^[›>❯●*]\s*(?:\d+[.)]\s*)?(?:Skip|Later|No|Cancel|Ignore|Dismiss)\b/i.test(line))) {
        return false;
    }
    return lines.some(line =>
        /^[›>❯●*]\s*(?:1[.)]\s*)?(?:Update|Upgrade|Install\s+update)(?:\s+now|\s+to\b|\s*\(|$)/i.test(line));
}

export function isCliSelfUpdateCommand(inputLine: string): boolean {
    const trimmed = inputLine.trim();
    return /^(?:\/(?:update|upgrade)|(?:codex|claude|agy|antigravity|opencode|pi|grok|kimi|copilot)\s+(?:update|upgrade|self-update))\s*$/i.test(trimmed);
}

export function isCliSelfUpdateOutput(text: string): boolean {
    const plain = stripTerminalEscapes(text);
    return /\b(?:Updating|Upgrading)\s+(?:Codex|Claude(?:\s+Code)?|Antigravity|agy|OpenCode|Pi(?:\s+Coding\s+Agent)?|Grok(?:\s+Build)?|Kimi(?:\s+Code)?|GitHub\s+Copilot|Copilot)\b/i.test(plain)
        || /\b(?:Updating|Upgrading)\b[^\r\n]{0,80}\bvia\s+[`'"]?(?:sh|bash|curl|npm|pnpm|yarn|bun|brew|winget|pwsh|powershell|uv|pip)\b/i.test(plain)
        || /\bhttps:\/\/chatgpt\.com\/codex\/install\.sh\b/i.test(plain)
        || /\bCODEX_NON_INTERACTIVE=1\b/.test(plain)
        || /\b(?:Update|Upgrade)\s+ran\s+successfully!\s*Please\s+restart\b/i.test(plain)
        || /\bSuccessfully\s+(?:updated|upgraded)\s+(?:Codex|Claude(?:\s+Code)?|Antigravity|agy|OpenCode|Pi|Grok(?:\s+Build)?|Kimi(?:\s+Code)?|GitHub\s+Copilot|Copilot|to\s+v?\d)\b/i.test(plain)
        || /\bPlease\s+restart\s+(?:Codex|Claude(?:\s+Code)?|Antigravity|agy|OpenCode|Pi|Grok(?:\s+Build)?|Kimi(?:\s+Code)?|GitHub\s+Copilot|Copilot)\b/i.test(plain)
        || /\b(?:npm\s+(?:install|i|update)\s+-g|pnpm\s+add\s+-g|bun\s+add\s+-g|uv\s+tool\s+upgrade)\s+(?:@openai\/codex|@anthropic-ai\/claude-code|@mariozechner\/pi-coding-agent|opencode-ai|@github\/copilot|kimi-cli)\b/i.test(plain);
}

export function hasCliSelfUpdateFailure(text: string): boolean {
    const plain = stripTerminalEscapes(text);
    if (/\b(?:(?:Update|Upgrade)\s+ran\s+successfully|Successfully\s+(?:updated|upgraded|installed))\b/i.test(plain)) {
        return false;
    }
    return /\b(?:Update|Upgrade|Install(?:ation)?)\s+failed\b/i.test(plain)
        || /\bcurl:\s*\(\d+\)\s+/i.test(plain)
        || /\bnpm\s+ERR!\b/i.test(plain)
        || /\b(?:EACCES|EPERM|ETIMEDOUT|ECONNREFUSED|ENOTFOUND)\b/.test(plain)
        || /\bPermission\s+denied\b/i.test(plain);
}

/** Decide whether background PTY output should mark an unfocused task as unread. */
export function shouldMarkTaskUnreadOnOutput(
    task: Pick<Task, 'status' | 'activity' | 'unread'> & Partial<Pick<Task, 'executable' | 'codex' | 'cliSession'>>,
    selected: unknown,
    output: string,
    blurredAt?: number,
    now = Date.now(),
): boolean {
    if (task.status !== 'running' || selected === task || task.unread) return false;
    if (!hasVisibleTerminalText(output)) return false;
    if (task.activity !== undefined || (task.executable && isTrackedAiTask({ executable: task.executable, codex: task.codex, cliSession: task.cliSession }))) {
        return task.activity === 'working' || task.activity === 'waiting';
    }
    return blurredAt === undefined || now - blurredAt >= 800;
}

export function hasScreenInterrupt(screen?: TerminalScreen): boolean {
    if (!screen?.buffer?.active) return false;
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 14);
    for (let offset = 0; offset < Math.min(18, bottom + 1); offset++) {
        const line = buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '';
        if (!line) continue;
        if (/(?:^|[\s│┃▌(\[•·▪■▫⬝\u2800-\u28ff])(?:esc|ctrl\+c)\s+(?:(?:again\s+)?to\s+|again\s+to\s+)?(?:interrupt|cancel|stop)(?:\s|\)|\]|$)/i.test(line)
            || /\bsend a message to interrupt\b/i.test(line)
            || /\b(?:Working|Thinking)\s*\([^)]*\besc\b/i.test(line)) {
            return true;
        }
    }
    return false;
}

export function hasScreenAuthPrompt(screen?: TerminalScreen): boolean {
    if (!screen?.buffer?.active || hasScreenInterrupt(screen) || hasActiveFooterTasks(screen)) return false;
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 14);
    const lines: string[] = [];
    for (let offset = 0; offset < Math.min(28, bottom + 1) && lines.length < 24; offset++) {
        const line = buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '';
        if (line) lines.push(line);
    }
    if (!lines.length) return false;
    const joined = lines.join('\n');
    if (/\?\s*for shortcuts\b|\b(?:accept-edits|acceptEdits|auto-edit)\s*·|\bAsk Codex to do anything\b|\bType @ to mention\b|\[Dashboard\]/i.test(joined)) {
        return false;
    }
    return /\bWaiting for (?:authentication|authorization|login|sign[- ]?in)\b/i.test(joined)
        || /\b(?:Sign in|Log in|Login)\s+(?:with|to|using)\s+(?:Google|GitHub|ChatGPT|OpenAI|Anthropic|Claude|xAI|Grok|Kimi|your\s+account|browser)\b/i.test(joined)
        || /\b(?:Select|Choose)\s+(?:a\s+)?(?:login|auth(?:entication)?|sign[- ]?in)\s+method\b/i.test(joined)
        || /\b(?:Authentication|Login|Sign[- ]?in)\s+required\b|\bNot\s+(?:logged|signed)\s+in\b|\bPlease\s+(?:log|sign)\s+in\b/i.test(joined)
        || /\b(?:Enter|Paste)\s+(?:the\s+)?(?:authorization|verification|one-time|device)\s+code\b/i.test(joined)
        || (/\bPress\s+Enter\s+to\s+(?:open|sign\s+in|log\s+in|authenticate)\b/i.test(joined) && /\b(?:auth|login|sign[- ]?in|oauth|browser|account)\b/i.test(joined))
        || (/\bhttps?:\/\/\S+(?:oauth|login|auth|device)\S*/i.test(joined) && /\b(?:code|browser|authenticate|authorize|sign\s+in|log\s+in)\b/i.test(joined));
}

export function codexScreenIsIdle(screen?: TerminalScreen): boolean {
    if (!screen?.buffer?.active || hasScreenInterrupt(screen)) return false;
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 12);
    const lines = Array.from({ length: Math.min(16, bottom + 1) }, (_, offset) =>
        buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '').filter(Boolean);
    return lines.some(line =>
        /^(?:[│┃▌›>❯]\s*)?Ask Codex to do anything\b/i.test(line)
        || (/\bContext\s+\d+(?:\.\d+)?%\s+used\b/i.test(line) && /\bStarting\b/i.test(line)));
}

const terminalErrorLine = /^(?:[│┃▌⎿✖✗×!●•]\s*)*(?:Error|API\s*Error|APIError|Provider\s*Error|ProviderError|Retry\s*Error|RetryError|Authentication\s*Error|Permission\s*Error|Rate\s*limit\s*exceeded|Quota\s*exceeded|Request\s*failed|Retry\s*failed|Stream\s*disconnected|Exceeded\s*retry\s*limit|Fatal\s*error|Unhandled\s*error)\b[:：]?/i;

function isErrorOutputLine(text: string): boolean {
    if (!text || isAbortMessage(text)) return false;
    return terminalErrorLine.test(text)
        || /"status"\s*:\s*"(?:UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|PERMISSION_DENIED|UNAUTHENTICATED)"/i.test(text)
        || /"code"\s*:\s*(?:4\d\d|5\d\d)\b.*"status"\s*:/i.test(text);
}

function hasTrailingError(lines: readonly string[], limit = 6): boolean {
    let checked = 0;
    for (const raw of lines) {
        const text = raw.trim();
        if (!text) continue;
        checked++;
        if (isAbortMessage(text)) return false;
        if (isErrorOutputLine(text)) return true;
        if (checked >= limit) break;
    }
    return false;
}

function hasRecentErrorAbove(lineAt: (row: number) => string, upperRow: number): boolean {
    let checked = 0;
    for (let r = upperRow - 1; r >= Math.max(0, upperRow - 10) && checked < 4; r--) {
        const text = lineAt(r);
        if (!text) continue;
        checked++;
        if (isAbortMessage(text)) return false;
        if (isErrorOutputLine(text)) return true;
    }
    return false;
}

function hasScreenAbort(screen?: TerminalScreen): boolean {
    if (!screen?.buffer?.active) return false;
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 12);
    let checked = 0;
    for (let offset = 0; offset < Math.min(16, bottom + 1) && checked < 10; offset++) {
        const text = buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '';
        if (!text) continue;
        checked++;
        if (isAbortMessage(text)) return true;
        if (isErrorOutputLine(text)) return false;
    }
    return false;
}

function codexScreenHasError(screen?: TerminalScreen): boolean {
    if (!screen?.buffer?.active) return false;
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 12);
    const lines = Array.from({ length: Math.min(14, bottom + 1) }, (_, offset) =>
        buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '');
    return hasTrailingError(lines, 6);
}

export function terminalEditorActivity(screen: TerminalScreen): CodexActivity | undefined {
    const buffer = screen.buffer.active;
    const lineAt = (row: number) => buffer.getLine(buffer.baseY + row)?.translateToString(true).trim() ?? '';
    const border = /^[╭╰┌└]?[─━═]{12,}[╮╯┐┘]?$/;
    const workingBorder = /^[─━═]+\s+(?:[\u2800-\u28ff●•·*▪■▫⬝◦]\s*)?(?:Working|Thinking|Compacting|Auto-compacting|Retrying|Summarizing)\b/i;
    const workingIndicator = /^(?:[\u2800-\u28ff●•·*▪■▫⬝◦]\s*)?(?:Working|Thinking|Compacting|Auto-compacting|Retrying|Summarizing)\b/i;
    const bottom = screen.rows - 1;
    const recentRows = Array.from({ length: Math.min(16, bottom + 1) }, (_, offset) => lineAt(bottom - offset));
    if (recentRows.some(line => /(?:Do you want to proceed|Allow once|Permission required)\b/i.test(line))
        && recentRows.some(line => /(?:Esc to cancel|Yes, allow|Deny|\[y\/n\]|\(y\/n\))/i.test(line))) {
        return 'waiting';
    }
    if (recentRows.some(line => /(?:^|[\s│┃▌(\[•·▪■▫⬝\u2800-\u28ff])(?:esc|ctrl\+c)\s+(?:(?:again\s+)?to\s+|again\s+to\s+)?(?:interrupt|cancel|stop)(?:\s|\)|\]|$)/i.test(line))) {
        return 'working';
    }
    if (hasActiveFooterTasks(screen)) {
        return 'working';
    }
    let lower = -1;
    const startRow = Math.max(screen.rows - 1, Math.min(screen.rows - 1, buffer.cursorY + 12));
    const endRow = Math.max(0, Math.min(buffer.cursorY - 32, screen.rows - 36));
    // Find the live editor at the bottom of the buffer even when the user scrolls up.
    for (let row = startRow; row >= endRow; row--) {
        const line = lineAt(row);
        if (lower < 0) {
            if (border.test(line)) lower = row;
        } else if (lower - row <= 12 && workingBorder.test(line)) {
            return 'working';
        } else if (border.test(line)) {
            if (lower - row <= 12 && workingIndicator.test(lineAt(row - 1))) return 'working';
            return hasRecentErrorAbove(lineAt, row) ? 'error' : 'ready';
        }
    }
    // Fallback for borderless shaded input boxes (e.g. '>' prompt above '? for shortcuts' or mode footer).
    if (recentRows.some(line => /\?\s*for shortcuts\b|\b(?:accept-edits|acceptEdits|auto-edit|plan|default)\s*·/i.test(line))) {
        for (let row = bottom; row >= Math.max(0, bottom - 18); row--) {
            const line = lineAt(row);
            if (/^(?:[│┃▌]\s*)?[>›❯](?:\s|$)/.test(line)) {
                if (row > 0 && workingIndicator.test(lineAt(row - 1))) return 'working';
                return hasRecentErrorAbove(lineAt, row) ? 'error' : 'ready';
            }
        }
    }
}

export function hasActiveFooterTasks(screen?: TerminalScreen): boolean {
    if (!screen?.buffer?.active) return false;
    const buffer = screen.buffer.active;
    const lineAt = (row: number) => buffer.getLine(buffer.baseY + row)?.translateToString(true).trim() ?? '';
    const border = /^[╭╰┌└]?[─━═]{12,}[╮╯┐┘]?$/;
    const bottom = screen.rows - 1;
    const footerRows: string[] = [];
    let hasPromptOrBorderAbove = false;
    for (let row = bottom; row >= Math.max(0, bottom - 22); row--) {
        const line = lineAt(row);
        if (!line) continue;
        if (/^(?:[│┃▌]\s*)?[>›❯](?:\s|$)/.test(line) || border.test(line)) {
            hasPromptOrBorderAbove = true;
            break;
        }
        footerRows.push(line);
        if (footerRows.length >= 16) break;
    }
    if (!hasPromptOrBorderAbove) return false;
    return footerRows.some(line =>
        /(?:·|\s|^)[1-9]\d*\s+(?:tasks?|task\(s\)|subagents?|subagent\(s\)|agents?|agent\(s\)|background\s+tasks?|local\s+agents?)(?:\s|$|·)/i.test(line)
        || (/·\s*\/(?:tasks|subagents|agents)\b/i.test(line) && /\b[1-9]\d*\b/.test(line))
        || /^[\u2800-\u28ff●•·*▪■▫⬝◦]\s+(?:(?:Agent|Subagent|Task|Background\s+task)\s*\(|(?:\[\d{2}:\d{2}:\d{2}\]\s+)?.*\s+(?:running|in progress|working|thinking)\s*$|.*·\s*(?:\d+h\s*)?(?:\d+m\s*)?\d+s\s*$)/i.test(line));
}

export function grokActivity(screen: TerminalScreen): CodexActivity | undefined {
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 14);
    const lines = Array.from({ length: Math.min(20, bottom + 1) }, (_, offset) =>
        buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '');
    if (lines.some(line => /(?:Allow|Approve|Reject|Deny)\b.*(?:\[y\/n\]|\(y\/n\)|enter to confirm)/i.test(line)
        || /Permission required|Waiting for approval|Waiting for answers/i.test(line))) return 'waiting';
    if (lines.some(line => /(?:^|[\s│┃▌(\[•·▪■▫⬝\u2800-\u28ff])(?:esc|ctrl\+c)\s+(?:to\s+)?(?:interrupt|cancel|stop)(?:\s|\)|\]|$)/i.test(line)
        || /\bsend a message to interrupt\b/i.test(line))) return 'working';
    if (lines.some(line => /\bGrok\s+\d+(?:\.\d+)?\b.*(?:always-approve|auto|plan|default|acceptEdits)/i.test(line)
        || /\[Dashboard\]/i.test(line)
        || /\bWorked for\s+\d/i.test(line))) {
        return hasTrailingError(lines, 6) || lines.some(line => /^Turn failed\b/i.test(line)) ? 'error' : 'ready';
    }
    if (lines.slice(0, 6).some(line => /^[\u2800-\u28ff]\s*(?:Thinking|Working|Running|Executing|Responding|Generating|Searching|Reading|Editing|Retrying)\b/i.test(line))) {
        return 'working';
    }
}

export function copilotActivity(screen: TerminalScreen): CodexActivity | undefined {
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 14);
    const lines = Array.from({ length: Math.min(20, bottom + 1) }, (_, offset) =>
        buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '');
    if (lines.some(line => /(?:Allow|Approve|Yes,\s*and\s*allow|Permission required|for the rest of session)\b/i.test(line)
        && /(?:Once|Always|Deny|Reject|\[y\/n\]|\(y\/n\)|enter to confirm)/i.test(lines.join(' ')))) return 'waiting';
    if (lines.some(line => /(?:^|[\s│┃▌(\[•·▪■▫⬝\u2800-\u28ff])(?:esc|ctrl\+c)\s+(?:to\s+)?(?:cancel|interrupt|stop)(?:\s|\)|\]|$)/i.test(line))) return 'working';
    if (lines.some(line => /Type @ to mention|shift\+tab\b.*\bmode|\?\s*for shortcuts/i.test(line))) {
        return hasTrailingError(lines, 6) ? 'error' : 'ready';
    }
    if (lines.slice(0, 6).some(line => /^[\u2800-\u28ff]\s*(?:Thinking|Working|Running|Executing|Generating|Searching|Reading|Editing|Compacting|Retrying)\b/i.test(line))) {
        return 'working';
    }
    return terminalEditorActivity(screen);
}

export function parseProgressOsc(chunk: string): CodexActivity | undefined {
    const regex = /\x1b\]9;4;(\d+)(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;
    let last: CodexActivity | undefined;
    while ((match = regex.exec(chunk)) !== null) {
        const state = match[1];
        if (state === '1') last = 'working';
        else if (state === '2') last = 'error';
        else if (state === '3') last = 'waiting';
        else if (state === '0' && last !== 'error') last = 'ready';
    }
    return last;
}

export function grokTerminalTitle(text: string): CodexActivity | undefined {
    const value = text.trim();
    if (!value) return undefined;
    if (/\bAction required\b/i.test(value) || /^\[!\]/.test(value)) return 'waiting';
    if (/^[\u2800-\u28ff]/.test(value)) return 'working';
    return undefined;
}

function parseProgramStatusOsc(chunk: string): CodexActivity | undefined {
    const regex = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;
    let last: CodexActivity | undefined;
    while ((match = regex.exec(chunk)) !== null) {
        const body = match[1];
        if (!body || body.startsWith('?')) continue;
        const state = body.split(':').find(part => part.startsWith('state='))?.slice(6);
        if (state === 'working') last = 'working';
        else if (state === 'blocked') last = 'waiting';
        else if (state === 'error') last = 'error';
        else if ((state === 'idle' || state === 'done') && last !== 'error') last = 'ready';
    }
    return last;
}

function parseCompactNumber(raw: string, unit?: string): number {
    const val = parseFloat(raw);
    if (!Number.isFinite(val)) return 0;
    const u = (unit ?? '').toLowerCase();
    return Math.round(val * (u === 'm' ? 1_000_000 : u === 'k' ? 1_000 : 1));
}

function piFooterDetails(screen: TerminalScreen): SessionDetails | undefined {
    const buffer = screen.buffer.active;
    const lineAt = (row: number) => buffer.getLine(buffer.baseY + row)?.translateToString(true).trim() ?? '';
    const startRow = Math.max(screen.rows - 1, Math.min(screen.rows - 1, buffer.cursorY + 12));
    const endRow = Math.max(0, startRow - 12);
    const ctxRegex = /(\d+(?:\.\d+)?)%\/(\d+(?:\.\d+)?)([kKmM])\b(?:\s*\(auto\))?/;
    for (let row = startRow; row >= endRow; row--) {
        const line = lineAt(row);
        const match = ctxRegex.exec(line);
        if (!match) continue;
        const percent = parseFloat(match[1]);
        const window = parseCompactNumber(match[2], match[3]);
        const contextTokens = window > 0 ? Math.round((percent / 100) * window) : undefined;
        const detail: SessionDetails = {
            context: { percent, window: window || undefined, tokens: contextTokens },
        };
        const left = line.slice(0, match.index);
        let total = 0;
        const tokenMatches = left.matchAll(/[↑↓RW]([\d.]+)([kKmM])?\b/g);
        for (const tm of tokenMatches) total += parseCompactNumber(tm[1], tm[2]);
        if (total > 0) detail.tokens = total;

        const right = line.slice(match.index + match[0].length).trim();
        if (right) {
            const withoutProvider = right.replace(/^\([^)]+\)\s*/, '').trim();
            const parts = withoutProvider.split(/\s*•\s*/);
            const modelCandidate = parts[0]?.trim();
            if (modelCandidate && /^[a-zA-Z0-9][\w./:-]*$/.test(modelCandidate)) {
                detail.model = modelCandidate;
            }
            const effortRaw = parts[1]?.replace(/^thinking\s+/i, '').trim().toLowerCase();
            if (effortRaw) {
                detail.effort = effortRaw === 'off' ? undefined : effortRaw;
            }
        }
        return detail;
    }
}

export function openCodeActivity(screen: TerminalScreen): CodexActivity | undefined {
    const buffer = screen.buffer.active;
    const bottom = buffer.type === 'alternate' ? screen.rows - 1 : Math.min(screen.rows - 1, buffer.cursorY + 12);
    const lines = Array.from({ length: Math.min(16, bottom + 1) }, (_, offset) =>
        buffer.getLine(buffer.baseY + bottom - offset)?.translateToString(true).trim() ?? '');
    const footer = lines.slice(0, 6);
    if (lines.some(line => /^[│┃▌\s]*[△⚠]\s*Permission required\b/i.test(line))
        || (lines.some(line => /\bPermission required\b/i.test(line)) && lines.some(line => /\b(?:Allow once|Allow always|Reject)\b/i.test(line)))) {
        return 'waiting';
    }
    if (footer.some(line => /(?:^|[\s│┃▌▪■▫⬝⬞◼◻◾◽•●·◦○◉◌⋯…\u2800-\u28ff]|\[⋯\]\s*)esc\s+(?:(?:again to\s+)?interrupt|stop)(?:\s|$)/i.test(line))) {
        return 'working';
    }
    if (lines.some(line => /^(?:[│┃▌›>]\s*)?Ask anything(?:…|\.\.\.|,\s*\/\s*for commands)/i.test(line)
        || /(?:^|\s)ctrl\+p\s+commands(?:\s|$)/i.test(line))) {
        return hasTrailingError(lines, 8) ? 'error' : 'ready';
    }
}

const projectsKey = 'tabby-oneai.projects.v1';
const tasksKey = 'tabby-oneai.tasks.v1';
const cliCacheKey = 'tabby-oneai.cli-detection.v1';
const cliExecutables = supportedCli.map(cli => cli.executable);
const cliSignature = cliExecutables.join(',') + ':v3';
const recentLimit = 5;

interface CliCacheEntry { id: string; signature: string; available: string[]; }
type ProjectRecord = Project & { removed?: boolean; addedAt?: number; pinned?: boolean };
export interface RemovedSession {
    id: string;
    title: string;
    projectId: string;
    projectName?: string;
    distro?: string;
    executable?: string;
    removedAt: number;
    taskId?: string;
    sessionKey?: string;
    entry?: HistoryEntry;
}
const removedSessionsKey = 'tabby-oneai.removed-sessions.v1';
const historyId = (distro: string | undefined, account: string, session: string, executable = 'codex') =>
    `${(distro ?? 'windows').toLowerCase()}|${account}|${executable}|${session.toLowerCase()}`;

function load<T extends { id: string }>(key: string): T[] {
    try {
        const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(data) ? data.filter(item => typeof item?.id === 'string') : [];
    } catch {
        return [];
    }
}

function save<T extends { id: string }>(key: string, item: T): void {
    localStorage.setItem(key, JSON.stringify([...load<T>(key).filter(entry => entry.id !== item.id), item]));
}

function pruneStoredTasks(records: TaskRecord[]): TaskRecord[] {
    const counts = new Map<string, number>();
    const kept: TaskRecord[] = [];
    const sorted = [...records].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
    for (const item of sorted) {
        const hasHistoryLink = Boolean(item.cliSession?.id || item.codex?.sessionId);
        if (!hasHistoryLink) {
            if (!isTrackedAiTask(item)) kept.push(item);
            continue;
        }
        const count = (counts.get(item.projectId) ?? 0) + 1;
        counts.set(item.projectId, count);
        if (count <= 12) kept.push(item);
    }
    if (kept.length !== records.length) {
        try { localStorage.setItem(tasksKey, JSON.stringify(kept)); } catch { /* Ignore storage quota errors. */ }
    }
    return kept;
}

const sessionOpenTimeoutMessage = 'Tabby 未报告终端已启动。请检查终端输出。';

@Injectable()
export class WorkspaceService implements OnDestroy {
    private projectRecords = load<ProjectRecord>(projectsKey).map(project => ({ ...project, ...projectLocation(project.directory, project.distro) }));
    projects = this.projectRecords.filter(project => !project.removed);
    removedSessions = load<RemovedSession>(removedSessionsKey);
    tasks: Task[] = pruneStoredTasks(load<TaskRecord>(tasksKey)).map(task => ({
        ...task, codex: task.codex ?? (isCodex(task.executable) && !task.args.length ? { accountId: defaultAccount } : undefined),
        status: 'stopped', unread: false,
    }));
    readonly branches = new Map<string, string>();
    readonly folded = new Set<string>();
    collapsed = false;
    selected: Task | null = null;
    treeVersion = 0;

    private readonly subscriptions = new Subscription();
    private focusSubscription?: Subscription;
    private closeConfirm?: (tasks: Task[]) => Promise<boolean>;
    private closePromptPromise?: Promise<boolean>;
    private bypassClosePrompt = false;
    private startingTask?: Task;
    private readonly bindings = new Map<string, { pane: Tab; events: Subscription }>();
    private readonly blurredAt = new Map<string, number>();
    private readonly turnArmed = new Set<string>();
    private readonly newSessionExcludedKeys = new Map<string, Set<string>>();
    private readonly agyLiveSessionIds = new Map<string, string>();
    private readonly authWaitingTasks = new Set<string>();
    private readonly authRetriedTasks = new Set<string>();
    private readonly restartingTasks = new Set<string>();
    private readonly updatingTasks = new Map<string, { startedAt: number; output: string; restarting?: boolean }>();
    private readonly titleIds = new Map<string, string>();
    private readonly claudeTranscripts = new Map<string, string>();
    private readonly agyMeterActivities = new Map<string, CodexActivity>();
    private readonly piLiveDetail = new Map<string, SessionDetails>();
    private readonly detailPending = new Set<string>();
    private readonly detailTime = new Map<string, number>();
    private readonly projectHistory = new Map<string, HistoryEntry[]>();
    private readonly allProjectHistory = new Map<string, HistoryEntry[]>();
    private readonly historyLoads = new Map<string, symbol>();
    private readonly historyLimits = new Map<string, number>();
    private readonly historyHasMore = new Map<string, Set<string>>();
    private readonly cliCache = new Map(load<CliCacheEntry>(cliCacheKey)
        .filter(item => item.signature === cliSignature && Array.isArray(item.available))
        .map(item => [item.id, item.available]));
    private readonly cliProbes = new Map<string, Promise<string[]>>();
    readonly cliDirectories = new CliDirectories();
    private readonly cliHistory = new CliHistory(this.cliDirectories);

    constructor(
        @Inject(AppService) readonly app: App,
        @Inject(ProfilesService) private readonly profiles: Profiles,
        @Inject(PlatformService) readonly platform: Platform,
        @Inject(CodexService) readonly codex: CodexService,
        @Inject(NgZone) private readonly zone: NgZone,
        @Inject(WorkbenchI18n) private readonly i18n: WorkbenchI18n,
    ) {
        this.subscriptions.add(this.app.activeTabChange$.subscribe(() => this.watchFocus()));
        this.subscriptions.add(this.app.ready$.subscribe(() => {
            this.connectRestoredTasks();
            this.watchFocus();
            for (const project of this.projects) void this.refreshBranch(project);
            for (const distro of new Set([undefined, ...this.projects.map(project => project.distro)])) this.preloadCli(distro);
            this.refreshRecentHistory();
        }));
        this.subscriptions.add(this.app.tabsChanged$.subscribe(() => this.connectRestoredTasks()));
        this.connectRestoredTasks();
        this.zone.runOutsideAngular(() => {
            const timer = setInterval(() => {
                const running = this.tasks.filter(task => task.status === 'running');
                const active = this.selected && this.selected.status === 'running'
                    ? [this.selected, ...running]
                    : running;
                for (const task of [...new Set(active)].slice(0, 6)) {
                    void this.updateDetails(task);
                }
            }, 4500);
            this.subscriptions.add(() => clearInterval(timer));
        });
        const origCloseWindow = this.app.closeWindow?.bind(this.app);
        if (origCloseWindow) {
            this.app.closeWindow = async () => {
                const active = this.activeRunningTasks();
                if (active.length && !this.bypassClosePrompt) {
                    const confirmed = await this.confirmClosingTasks(active);
                    if (!confirmed) return;
                }
                this.bypassClosePrompt = true;
                try {
                    await origCloseWindow();
                } finally {
                    this.bypassClosePrompt = false;
                }
            };
            this.subscriptions.add(() => { this.app.closeWindow = origCloseWindow; });
        }
    }

    registerCloseConfirm(handler?: (tasks: Task[]) => Promise<boolean>): void {
        this.closeConfirm = handler;
    }

    activeRunningTasks(): Task[] {
        return this.tasks.filter(task => this.bindings.has(task.id) && isTaskActiveExecution(task));
    }

    private confirmClosingTasks(tasks: Task[]): Promise<boolean> {
        if (!tasks.length || !this.closeConfirm) return Promise.resolve(true);
        if (this.closePromptPromise) return this.closePromptPromise;
        this.closePromptPromise = Promise.resolve(this.closeConfirm(tasks))
            .catch(() => true)
            .finally(() => { this.closePromptPromise = undefined; });
        return this.closePromptPromise;
    }

    projectFor(task: Task): Project | undefined {
        return this.projectRecords.find(project => project.id === task.projectId);
    }

    isPinned(project: Project): boolean {
        return Boolean(this.projectRecords.find(item => item.id === project.id)?.pinned);
    }

    togglePin(project: Project): void {
        const record = this.projectRecords.find(item => item.id === project.id);
        if (!record) return;
        record.pinned = !record.pinned;
        save<ProjectRecord>(projectsKey, record);
        this.projects = this.projectRecords.filter(item => !item.removed);
        this.treeVersion++;
    }

    projectUpdatedAt(project: Project): number {
        const record = this.projectRecords.find(item => item.id === project.id);
        let latest = record?.addedAt ?? 0;
        for (const task of this.tasksFor(project)) {
            latest = Math.max(latest, this.sessionUpdatedAt(project, task));
        }
        for (const entry of this.projectHistory.get(project.id) ?? []) {
            if (!this.isHistoryRemoved(entry)) latest = Math.max(latest, entry.updatedAt);
        }
        return latest;
    }

    tasksFor(project: Project): Task[] {
        return this.tasks.filter(task => task.projectId === project.id && !this.isTaskRemoved(task));
    }

    cachedCli(distro?: string): readonly string[] | undefined {
        return this.cliCache.get(distro ? `wsl:${distro}` : 'windows');
    }

    private preloadCli(distro?: string): void { void this.availableCli(distro).catch(() => {}); }

    async availableCli(distro?: string, refresh = false): Promise<readonly string[]> {
        const id = distro ? `wsl:${distro}` : 'windows';
        const cached = this.cliCache.get(id);
        if (cached && !refresh) return cached;
        const pending = this.cliProbes.get(id);
        if (pending) return pending;
        const probe = detectAvailableCli(distro, cliExecutables).then(available => {
            this.cliCache.set(id, available);
            try { save<CliCacheEntry>(cliCacheKey, { id, signature: cliSignature, available }); }
            catch { /* The in-memory result is still usable. */ }
            return available;
        }).finally(() => this.cliProbes.delete(id));
        this.cliProbes.set(id, probe);
        return probe;
    }

    recentFor(project: Project): HistoryEntry[] | undefined {
        const sessions = this.projectHistory.get(project.id);
        if (!sessions) return;
        const tasks = this.tasksFor(project);
        const attached = new Set(tasks.map(task => this.taskSessionKey(task)));
        return sessions.filter(entry => !this.isHistoryRemoved(entry) && !attached.has(this.entryKey(entry)));
    }

    hasMoreHistory(project: Project, executable: string): boolean {
        return Boolean(this.historyHasMore.get(project.id)?.has(executable));
    }

    loadMoreHistory(project: Project, count: number): void {
        this.historyLimits.set(project.id, Math.max(count, this.historyLimits.get(project.id) ?? recentLimit));
        void this.loadRecentHistory(project);
    }

    sessionUpdatedAt(project: Project, task: Task): number {
        const key = this.taskSessionKey(task);
        const current = Math.max(task.lastActiveAt ?? 0, task.detail?.updatedAt ?? 0);
        if (!key) return current;
        const history = this.projectHistory.get(project.id)?.find(entry => this.entryKey(entry) === key);
        return Math.max(current, history?.updatedAt ?? 0);
    }

    refreshRecentHistory(): void {
        for (const project of this.projects) void this.loadRecentHistory(project);
    }

    async refreshProjectHistory(project: Project): Promise<void> {
        this.cliHistory.clearCache();
        this.codex.clearHistoryCache(project.distro);
        this.cliDirectories.reload(project.distro);
        await Promise.all([
            this.loadRecentHistory(project),
            this.refreshBranch(project),
            this.availableCli(project.distro, true).catch(() => undefined),
        ]);
    }

    async refreshRuntimeHistory(distro?: string): Promise<void> {
        this.codex.reloadDefault(distro);
        this.cliDirectories.reload(distro);
        await Promise.all(this.projects.filter(project => project.distro === distro).map(project => this.loadRecentHistory(project)));
    }

    private async loadRecentHistory(project: Project): Promise<void> {
        const load = Symbol();
        this.historyLoads.set(project.id, load);
        try {
            const limit = this.historyLimits.get(project.id) ?? recentLimit;
            const entries = await this.projectSessions(project, limit + this.tasksFor(project).length + this.removedSessions.length + 1);
            if (this.historyLoads.get(project.id) !== load) return;
            const counts = new Map<string, number>();
            const hasMore = new Set<string>();
            const shown = entries.filter(entry => {
                if (this.isHistoryRemoved(entry)) return false;
                const bound = this.historyTask(entry, project.id);
                if (bound) {
                    if (entry.title && !this.isDefaultNameFor(bound.executable, entry.title) && this.isDefaultTaskName(bound)) {
                        this.zone.run(() => {
                            bound.name = entry.title;
                            if (bound.cliSession) bound.cliSession.title = entry.title;
                            this.bindings.get(bound.id)?.pane.setTitle?.(`${bound.name} · ${project.name}`);
                            this.saveTask(bound);
                        });
                    }
                    return true;
                }
                const key = entry.cli?.executable ?? 'codex';
                const count = (counts.get(key) ?? 0) + 1;
                counts.set(key, count);
                if (count > limit) hasMore.add(key);
                return count <= limit;
            });
            this.zone.run(() => {
                this.historyHasMore.set(project.id, hasMore);
                this.projectHistory.set(project.id, shown);
                this.treeVersion++;
            });
        } catch {
            if (this.historyLoads.get(project.id) === load) this.zone.run(() => {
                this.projectHistory.set(project.id, []);
                this.treeVersion++;
            });
        } finally {
            if (this.historyLoads.get(project.id) === load) this.historyLoads.delete(project.id);
        }
    }

    cachedProjectSessions(project: Project): HistoryEntry[] {
        return (this.allProjectHistory.get(project.id) ?? this.projectHistory.get(project.id) ?? [])
            .filter(entry => !this.isHistoryRemoved(entry));
    }

    async projectSessions(project: Project, limit: number): Promise<HistoryEntry[]> {
        const native = this.cliHistory.list(project, limit, (executable) => this.availableCli(project.distro).then(items => items.includes(executable)));
        const scopes = (await this.codex.scopes([project.distro])).filter(scope => scope.distro === project.distro);
        const windows = await Promise.all(scopes.map(scope => this.codex.history(scope, project.directory, limit, true)));
        const cli = (await native).map(session => ({
            id: session.id, cwd: session.cwd, title: session.title, updatedAt: session.updatedAt, cli: session,
            scope: this.cliScope(project, session),
        }));
        const result = [...windows.flat(), ...cli].filter(entry => this.historyProject(entry)?.id === project.id).sort((a, b) => b.updatedAt - a.updatedAt);
        this.allProjectHistory.set(project.id, result);
        return result;
    }

    async entryFor(task: Task): Promise<HistoryEntry | undefined> {
        const project = this.projectFor(task);
        if (!project) return undefined;
        await this.updateDetails(task, true);
        if (task.cliSession) return {
            ...task.cliSession, cli: task.cliSession,
            scope: this.cliScope(project, task.cliSession),
        };
        if (task.codex?.sessionId) return this.codex.scope(project.distro, task.codex.accountId).then(scope => ({
            id: task.codex!.sessionId!, cwd: task.directory ?? project.directory, title: task.name, updatedAt: Date.now(), scope,
        }));
        return undefined;
    }

    private cliScope(project: Project, session: NonNullable<HistoryEntry['cli']>): CodexScope {
        const id = session.directoryId ?? defaultAccount;
        return { key: `${project.distro ?? 'windows'}|${session.executable}|${id}`, name: session.executable, id,
            directory: session.dataDirectory ?? '', home: '', distro: project.distro };
    }

    async sessionPrompts(entry: HistoryEntry) {
        return entry.cli ? this.cliHistory.prompts({ id: '', name: entry.title, directory: entry.cwd, distro: entry.scope.distro }, entry.cli)
            : this.codex.prompts(entry);
    }

    async sessionUsage(entry: HistoryEntry) {
        return entry.cli ? this.cliHistory.usage(entry.cli) : this.codex.sessionUsage(entry);
    }

    async addFolder(directory: string, distro?: string): Promise<void> {
        ({ directory, distro } = await resolveProjectLocation(directory, distro));
        const name = (distro ? posix : win32).basename(directory) || directory;
        const project: ProjectRecord = { id: randomUUID(), name, directory, distro, addedAt: Date.now() };
        await checkDirectory(project);
        const existing = this.projectRecords.find(item => item.distro?.toLowerCase() === distro?.toLowerCase() && equalPath(item.directory, directory, distro));
        if (existing) {
            existing.addedAt = Date.now();
            this.folded.delete(existing.id);
            this.restoreProject(existing.id);
            return;
        }
        save(projectsKey, project);
        this.projectRecords.push(project);
        this.restoreProject(project.id);
    }

    async openProjectFolder(project: Project): Promise<void> {
        await checkDirectory(project);
        const target = project.distro ? await localReadPath(project.directory, project.distro) : project.directory;
        if (!this.platform.openPath) throw new Error(this.i18n.text('当前 Tabby 环境不支持打开系统文件夹。', 'Opening folders is not supported in this Tabby environment.'));
        this.platform.openPath(target);
    }

    removeProject(project: Project): void {
        const record: ProjectRecord = { ...project, removed: true };
        save(projectsKey, record);
        this.projectRecords = this.projectRecords.map(item => item.id === project.id ? record : item);
        this.projects = this.projectRecords.filter(item => !item.removed);
        this.historyLoads.delete(project.id);
        this.projectHistory.delete(project.id);
        this.allProjectHistory.delete(project.id);
        this.historyHasMore.delete(project.id);
        if (this.selected?.projectId === project.id) this.selectTask(null);
        this.treeVersion++;
    }

    private restoreProject(id: string): void {
        const record = this.projectRecords.find(project => project.id === id);
        if (!record) return;
        if (record.removed) {
            save<ProjectRecord>(projectsKey, { ...record, removed: false });
            record.removed = false;
        }
        this.projects = this.projectRecords.filter(item => !item.removed);
        this.treeVersion++;
        void this.refreshBranch(record);
        void this.loadRecentHistory(record);
        this.preloadCli(record.distro);
    }

    isHistoryRemoved(entry: HistoryEntry): boolean {
        return this.removedSessions.some(item => item.sessionKey === this.entryKey(entry));
    }

    private entryKey(entry: HistoryEntry): string {
        return historyId(entry.scope.distro, entry.scope.id, entry.id, entry.cli?.executable);
    }

    private taskSessionKey(task: Task): string | undefined {
        const distro = this.projectFor(task)?.distro;
        if (task.cliSession) return historyId(distro, task.cliSession.directoryId ?? defaultAccount, task.cliSession.id, task.cliSession.executable);
        return task.codex?.sessionId ? historyId(distro, task.codex.accountId, task.codex.sessionId) : undefined;
    }

    private isTaskRemoved(task: Task): boolean {
        const key = this.taskSessionKey(task);
        return this.removedSessions.some(item => item.taskId === task.id || (key && item.sessionKey === key));
    }

    projectById(id: string): Project | undefined {
        return this.projectRecords.find(project => project.id === id);
    }

    removedSessionCli(record: RemovedSession): string {
        const raw = record.executable
            ?? record.entry?.cli?.executable
            ?? (record.taskId ? this.tasks.find(t => t.id === record.taskId)?.executable : undefined)
            ?? record.sessionKey?.split('|')[2]
            ?? 'codex';
        return cliBrand(raw)?.executable ?? raw;
    }

    removeSession(project: Project, item: Task | HistoryEntry): void {
        const task = 'projectId' in item ? item : undefined;
        const entry = 'scope' in item ? item : undefined;
        const sessionKey = entry ? this.entryKey(entry) : task ? this.taskSessionKey(task) : undefined;
        const rawExec = task ? task.executable : (entry?.cli?.executable ?? 'codex');
        const executable = cliBrand(rawExec)?.executable ?? rawExec;
        const record: RemovedSession = {
            id: randomUUID(),
            title: 'name' in item ? item.name : item.title,
            projectId: project.id,
            projectName: project.name,
            distro: project.distro,
            executable,
            removedAt: Date.now(),
            taskId: task?.id,
            sessionKey,
            entry,
        };
        save(removedSessionsKey, record);
        this.removedSessions = load(removedSessionsKey);
        if (task && this.selected === task) this.selectTask(null);
        this.treeVersion++;
        void this.loadRecentHistory(project);
    }

    restoreRemovedSession(record: RemovedSession): void {
        this.restoreRemovedSessions([record]);
    }

    restoreRemovedSessions(records: RemovedSession[]): void {
        if (!records.length) return;
        const ids = new Set(records.map(r => r.id));
        const affectedProjects = new Set<Project>();
        for (const record of records) {
            if (!this.projects.some(project => project.id === record.projectId)) this.restoreProject(record.projectId);
            const project = this.projects.find(item => item.id === record.projectId);
            if (project) {
                affectedProjects.add(project);
                if (record.entry && !this.historyTask(record.entry, project.id)) this.recordHistory(project, record.entry);
            }
        }
        const next = load<RemovedSession>(removedSessionsKey).filter(item => !ids.has(item.id));
        localStorage.setItem(removedSessionsKey, JSON.stringify(next));
        this.removedSessions = next;
        this.treeVersion++;
        for (const project of affectedProjects) void this.loadRecentHistory(project);
    }

    historyProject(entry: HistoryEntry): Project | undefined {
        const exact = this.projects.find(project => project.distro === entry.scope.distro && equalPath(project.directory, entry.cwd, project.distro));
        return exact ?? this.projects.filter(project => project.distro === entry.scope.distro && withinProject(entry.cwd, project.directory, project.distro))
            .sort((a, b) => b.directory.length - a.directory.length)[0];
    }

    historyTask(entry: HistoryEntry, projectId = this.historyProject(entry)?.id): Task | undefined {
        if (!projectId) return;
        const key = this.entryKey(entry);
        return this.tasks.find(task => task.projectId === projectId && this.taskSessionKey(task) === key);
    }

    async createTask(project: Project, name: string, command: Command, codex?: TaskRecord['codex'], directory?: string): Promise<void> {
        const cli = configurableCli(command.executable);
        const dataDirectory = cli ? this.cliDirectories.preferred(cli, project.distro)?.directory : undefined;
        const now = Date.now();
        await this.start(this.newTask({
            id: randomUUID(), projectId: project.id, name, ...command, codex, directory, dataDirectory,
            lastActiveAt: now,
        }));
    }

    private newTask(record: TaskRecord): Task {
        save(tasksKey, record);
        const task: Task = { ...record, status: 'stopped', unread: false };
        this.tasks.push(task);
        this.treeVersion++;
        return task;
    }

    private recordHistory(project: Project, entry: HistoryEntry): Task {
        const cli = entry.cli;
        const directory = equalPath(entry.cwd, project.directory, project.distro) ? undefined : entry.cwd;
        return this.newTask({ id: randomUUID(), projectId: project.id, name: entry.title, executable: cli?.executable ?? 'codex',
            args: cli?.args ?? [], cliSession: cli, directory, lastActiveAt: entry.updatedAt,
            codex: cli ? undefined : { accountId: entry.scope.id, sessionId: entry.id } });
    }

    async start(task: Task): Promise<void> {
        if (task.status === 'starting' || task.status === 'running') return;
        const parent = this.projectFor(task);
        if (!parent) return;
        const project = task.directory ? { ...parent, directory: task.directory } : parent;
        this.release(task);
        const isBrandNewSession = !task.cliSession && !task.codex?.sessionId && !task.args.length;
        let newSessionExcluded: Set<string> | undefined;
        if (isBrandNewSession) {
            newSessionExcluded = new Set<string>();
            for (const other of this.tasksFor(parent)) {
                const key = this.taskSessionKey(other);
                if (key) newSessionExcluded.add(key);
            }
            for (const entry of [...(this.projectHistory.get(parent.id) ?? []), ...(this.allProjectHistory.get(parent.id) ?? [])]) {
                newSessionExcluded.add(this.entryKey(entry));
            }
            task.startedAt = Date.now();
            task.lastActiveAt = task.startedAt;
        }
        this.setTaskStatus(task, 'starting');
        task.error = undefined;
        this.startingTask = task;
        this.selectTask(task);
        let meter: Awaited<ReturnType<typeof prepareAgyMeter>>;
        try {
            await checkDirectory(project);
            if (!await detect(project, task.executable)) throw new Error(this.i18n.text(`当前环境未找到 ${task.executable}。`, `${task.executable} was not found in the current environment.`));
            const cli = configurableCli(task.executable);
            const brandExec = cliBrand(task.executable)?.executable;
            const dataDirectory = task.cliSession?.dataDirectory ?? task.dataDirectory;
            const baseEnv = cli && dataDirectory ? { [directoryVariables[cli]]: dataDirectory,
                ...(cli === 'kimi' ? { KIMI_SHARE_DIR: dataDirectory } : {}) } : undefined;
            const env = brandExec === 'pi' ? { ...baseEnv, PI_PROGRAM_STATUS: '1' } : baseEnv;
            let command: Command = env
                ? { executable: task.executable, args: isBrandNewSession ? [] : [...task.args], env }
                : { executable: task.executable, args: isBrandNewSession ? [] : [...task.args] };
            if (task.codex) {
                const scope = await this.codex.scope(project.distro, task.codex.accountId);
                command = {
                    executable: task.executable, codexHome: scope.directory,
                    args: ['-c', codexTitleOption, ...(!isBrandNewSession && task.codex.sessionId ? ['resume', task.codex.sessionId] : [])],
                };
            } else if (cliBrand(task.executable)?.executable === 'agy' || cli === 'claude') {
                task.detail = undefined;
                meter = await prepareAgyMeter(project, command, cli === 'claude' ? 'claude' : 'agy', task.id).catch(() => undefined);
                if (meter) command = meter.command;
            }
            const pane = await this.profiles.openNewTabForProfile(profileFor(
                task.id, `${task.name} · ${project.name}`, project, command, statusColors.starting,
            ));
            if (!pane) throw new Error(this.i18n.text('Tabby 未能创建本地终端。', 'Tabby failed to create a local terminal.'));
            const now = Date.now();
            task.startedAt = now;
            task.lastActiveAt = now;
            try { this.saveTask(task); } catch { /* The terminal session has already started. */ }
            this.bind(task, pane);
            if (newSessionExcluded) this.newSessionExcludedKeys.set(task.id, newSessionExcluded);
            if (meter) {
                const link = meter;
                const events = this.bindings.get(task.id)!.events;
                this.attachAgyMeter(task, pane, project, dataDirectory, link.subscribe, events, link.dispose);
            }
            this.select(task);
        } catch (error) {
            meter?.dispose();
            this.setTaskStatus(task, 'failed');
            task.error = error instanceof Error ? error.message.split('\n')[0] : this.i18n.text('启动失败。', 'Failed to start.');
        } finally {
            if (this.startingTask === task) this.startingTask = undefined;
        }
    }

    async restoreHistory(entry: HistoryEntry): Promise<void> {
        let project = this.historyProject(entry);
        const matching = this.historyTask(entry, project?.id);
        if (matching) {
            if (matching.status === 'stopped' || matching.status === 'failed') await this.start(matching);
            else this.select(matching);
            if (matching.status === 'failed') throw new Error(matching.error);
            return;
        }
        if (!project) {
            await this.addFolder(entry.cwd, entry.scope.distro);
            project = this.historyProject(entry);
        }
        if (!project) throw new Error(this.i18n.text('无法定位会话对应的项目目录。', 'Could not locate the project directory for this session.'));
        const restored = this.recordHistory(project, entry);
        await this.start(restored);
        if (restored.status === 'failed') throw new Error(restored.error);
    }

    async refreshQuota(task: Task): Promise<void> {
        const project = this.projectFor(task);
        if (!task.codex || !project || task.refreshing) return;
        task.refreshing = true;
        task.refreshMessage = undefined;
        try {
            const scope = await this.codex.scope(project.distro, task.codex.accountId);
            const success = await this.codex.refresh(scope, task.codex.sessionId);
            task.refreshMessage = success
                ? this.i18n.text('额度已刷新', 'Quota refreshed')
                : this.i18n.text('Codex 当前未返回额度', 'Codex did not return quota data');
            await this.updateDetails(task, true);
        } catch {
            task.refreshMessage = this.i18n.text('无法读取当前账号额度', 'Unable to read current account quota');
        } finally { task.refreshing = false; }
    }

    select(task: Task): void {
        const pane = this.bindings.get(task.id)?.pane;
        if (pane) {
            const parent = this.app.getParentTab(pane);
            if (parent || this.app.tabs.includes(pane)) {
                this.app.selectTab(parent ?? pane);
                parent?.focus?.(pane);
            }
        }
        this.selectTask(task);
    }

    private selectTask(task: Task | null): void {
        const previous = this.selected;
        if (previous !== task) {
            if (previous) this.blurredAt.set(previous.id, Date.now());
            if (task) this.blurredAt.delete(task.id);
            this.selected = task;
            this.treeVersion++;
        }
        if (task) {
            if (task.unread) {
                task.unread = false;
                this.treeVersion++;
            }
            this.folded.delete(task.projectId);
            if (task.status === 'running' || (task.status !== 'starting' && !task.detail && Boolean(task.codex?.sessionId || task.cliSession))) {
                void this.updateDetails(task, !task.detail);
            }
        }
    }

    private watchFocus(): void {
        this.focusSubscription?.unsubscribe();
        const tab = this.app.activeTab;
        this.focusSubscription = tab?.focusChanged$?.subscribe(pane => this.zone.run(() => this.onPaneFocused(pane)));
        const activePane = tab?.getFocusedTab?.() ?? tab?.getAllTabs?.()[0] ?? tab;
        this.zone.run(() => this.onPaneFocused(activePane));
    }

    private onPaneFocused(pane: Tab | null): void {
        const binding = [...this.bindings.entries()].find(([, entry]) => entry.pane === pane);
        const matched = this.tasks.find(task => task.id === binding?.[0]) ?? null;
        if (!matched && this.startingTask && pane?.profile?.id === profilePrefix + this.startingTask.id) {
            this.selectTask(this.startingTask);
            return;
        }
        this.selectTask(matched);
    }

    private resolveTaskActivity(task: Task, pane: Tab, activity?: CodexActivity): CodexActivity | undefined {
        if (this.updatingTasks.has(task.id)) return 'working';
        if (activity !== 'working') return activity;
        const screen = pane.frontend?.xterm;
        if (task.codex && codexScreenIsIdle(screen)) return 'ready';
        if (!this.turnArmed.has(task.id) && !hasScreenInterrupt(screen) && !hasActiveFooterTasks(screen)) return 'ready';
        return 'working';
    }

    private reviveTimeoutFailedTask(task: Task): void {
        if (task.status === 'starting' || (task.status === 'failed' && task.error === sessionOpenTimeoutMessage)) {
            task.error = undefined;
            this.setTaskStatus(task, 'running');
        }
    }

    private attachAgyMeter(
        task: Task,
        pane: Tab,
        project: Project,
        dataDirectory: string | undefined,
        subscribe: (receive: (status: AgyStatus, fresh?: boolean) => void) => () => void,
        events: Subscription,
        dispose?: () => void,
    ): void {
        const received = subscribe(({ detail, activity, sessionId, transcript }, fresh = true) => this.zone.run(() => {
            if (fresh) this.reviveTimeoutFailedTask(task);
            const safeActivity = this.resolveTaskActivity(task, pane, activity);
            if (safeActivity) this.agyMeterActivities.set(task.id, safeActivity);
            const sameSession = !sessionId || sessionId === task.cliSession?.id;
            const existingTokens = sameSession ? task.detail?.tokens : undefined;
            const nextTokens = existingTokens !== undefined && detail.tokens !== undefined
                ? Math.max(existingTokens, detail.tokens)
                : (existingTokens ?? (task.cliSession ? undefined : detail.tokens));
            const hasError = safeActivity === 'working' ? false : task.detail?.hasError;
            task.detail = { ...detail, tokens: nextTokens, hasError };
            const screen = pane.frontend?.xterm;
            const tasksRunning = safeActivity !== 'waiting' && hasActiveFooterTasks(screen);
            const screenErr = safeActivity === 'ready' && screen && terminalEditorActivity(screen) === 'error';
            const rawResolved = tasksRunning ? 'working' : safeActivity === 'ready' && (hasError || screenErr) ? 'error' : safeActivity;
            const resolved = this.resolveTaskActivity(task, pane, rawResolved);
            if (fresh && (detail.quota || sessionId) && this.authWaitingTasks.has(task.id)) {
                this.authWaitingTasks.delete(task.id);
                this.recoverSiblingAuthWaitingTasks(task);
            }
            this.setActivity(task, resolved);
            if (sessionId && transcript && this.claudeTranscripts.get(task.id) !== transcript) {
                this.claudeTranscripts.set(task.id, transcript);
                if (task.cliSession?.id !== sessionId) {
                    task.cliSession = undefined;
                    void this.bindClaudeTranscript(task, project, sessionId, transcript, dataDirectory);
                }
            } else if (fresh && sessionId && !transcript && cliBrand(task.executable)?.executable === 'agy') {
                const prev = this.agyLiveSessionIds.get(task.id);
                if (prev !== sessionId) {
                    this.agyLiveSessionIds.set(task.id, sessionId);
                    if (!task.cliSession || task.cliSession.id !== sessionId) {
                        void this.updateDetails(task, true);
                    }
                }
            }
        }));
        events.add(received);
        if (dispose) events.add(dispose);
    }

    private async restoreAgyMeter(task: Task, pane: Tab, events: Subscription): Promise<void> {
        const project = this.projectFor(task);
        if (!project) return;
        const restoredAt = Date.now();
        const recovered = await recoverAgyMeter(pane.profile?.options, project).catch(() => undefined);
        const binding = this.bindings.get(task.id);
        if (!recovered || binding?.pane !== pane || events.closed) return;
        const dataDirectory = task.cliSession?.dataDirectory ?? task.dataDirectory;
        this.attachAgyMeter(task, pane, project, dataDirectory, receive => watchAgyMeterFile(recovered.resultFile, receive, restoredAt), events);
    }

    private readonly observed = new WeakSet<Tab>();
    private readonly observedSplits = new WeakSet<Tab>();

    private reconstructRestoredTask(taskId: string, pane: Tab): Task | undefined {
        const profile = pane.profile;
        const options = profile?.options;
        const args = Array.isArray(options?.args) ? options.args : [];
        const distIdx = args.indexOf('--distribution');
        const cdIdx = args.indexOf('--cd');
        const distro = distIdx >= 0 && typeof args[distIdx + 1] === 'string' ? args[distIdx + 1] : undefined;
        const rawDir = cdIdx >= 0 && typeof args[cdIdx + 1] === 'string'
            ? args[cdIdx + 1]
            : (typeof options?.cwd === 'string' ? options.cwd : undefined);
        const profileName = typeof profile?.name === 'string' ? profile.name : '';
        const project = (rawDir
            ? this.projects.filter(item => item.distro?.toLowerCase() === distro?.toLowerCase()
                && withinProject(rawDir, item.directory, item.distro))
                .sort((a, b) => b.directory.length - a.directory.length)[0]
            : undefined)
            ?? this.projects.find(item => item.distro?.toLowerCase() === distro?.toLowerCase()
                && profileName.endsWith(` · ${item.name}`))
            ?? (rawDir ? undefined : this.projects.find(item => profileName.endsWith(` · ${item.name}`)));
        if (!project) return;
        const iconHtml = typeof profile?.icon === 'string' && profile.icon ? profile.icon : (typeof pane.icon === 'string' ? pane.icon : '');
        let commandSample = Array.isArray(options?.args) ? options.args.join(' ') : '';
        const encIdx = Array.isArray(options?.args) ? options.args.findIndex(item => item.toLowerCase() === '-encodedcommand') : -1;
        if (encIdx >= 0 && typeof options?.args[encIdx + 1] === 'string') {
            try { commandSample += '\n' + Buffer.from(options.args[encIdx + 1], 'base64').toString('utf16le'); } catch {}
        }
        const matchedCli = supportedCli.find(item => item.icon === iconHtml)
            ?? supportedCli.find(item => new RegExp(`(?:^|[\\s'"\\\\/])${item.executable}(?:\\.(?:exe|cmd|bat|ps1|sh))?(?:[\\s'"]|$)`, 'i').test(commandSample));
        const executable = matchedCli?.executable ?? (project.distro ? 'bash' : 'pwsh.exe');
        const suffix = ` · ${project.name}`;
        const name = profileName.endsWith(suffix)
            ? profileName.slice(0, -suffix.length)
            : (profileName || matchedCli?.name || executable);
        const directory = rawDir && !equalPath(rawDir, project.directory, project.distro) ? rawDir : undefined;
        return this.newTask({
            id: taskId,
            projectId: project.id,
            name,
            executable,
            args: [],
            codex: isCodex(executable) ? { accountId: defaultAccount } : undefined,
            directory,
            lastActiveAt: Date.now(),
        });
    }

    private connectRestoredTasks(): void {
        for (const rootTab of this.app.tabs) {
            if (rootTab.initialized$ && !this.observedSplits.has(rootTab)) {
                this.observedSplits.add(rootTab);
                this.subscriptions.add(rootTab.initialized$.subscribe(() => this.zone.run(() => this.connectRestoredTasks())));
            }
        }
        const allPanes = this.app.tabs.flatMap(tab => tab.getAllTabs?.() ?? [tab]);
        const livePanes = new Set(allPanes);
        let boundAny = false;
        for (const tab of allPanes) {
            if (this.observed.has(tab)) continue;
            const id = tab.profile?.id;
            if (!id?.startsWith(profilePrefix)) continue;
            const rawId = id.slice(profilePrefix.length);
            let task = this.tasks.find(item => item.id === rawId) ?? this.reconstructRestoredTask(rawId, tab);
            if (!task) {
                this.observed.add(tab);
                continue;
            }
            const existing = this.bindings.get(task.id);
            if (existing) {
                if (!livePanes.has(existing.pane)) {
                    this.release(task);
                } else if (existing.pane !== tab) {
                    const cloned = this.newTask({
                        id: randomUUID(),
                        projectId: task.projectId,
                        name: task.name,
                        executable: task.executable,
                        args: [...task.args],
                        codex: task.codex ? { ...task.codex } : undefined,
                        directory: task.directory,
                        dataDirectory: task.dataDirectory,
                        lastActiveAt: Date.now(),
                    });
                    try { (tab.profile as { id?: string }).id = profilePrefix + cloned.id; } catch { /* Ignore readonly profile proxy. */ }
                    task = cloned;
                }
            }
            this.bind(task, tab, true);
            boundAny = true;
            if (this.hasPersistedSession(task)) {
                void this.syncLivePaneProfile(task);
            }
            if (!task.detail && (task.codex || task.cliSession || cliBrand(task.executable))) {
                void this.updateDetails(task, true);
            }
        }
        const focused = this.app.activeTab?.getFocusedTab?.() ?? this.app.activeTab?.getAllTabs?.()[0] ?? this.app.activeTab;
        if (boundAny && (!this.selected || (focused && this.observed.has(focused)))) {
            this.watchFocus();
        }
    }

    private bind(task: Task, pane: Tab, restored = false): void {
        if (this.bindings.get(task.id)?.pane === pane) return;
        this.release(task);
        this.observed.add(pane);
        if (restored && !task.startedAt) task.startedAt = task.lastActiveAt ?? Date.now();
        const events = new Subscription();
        this.bindings.set(task.id, { pane, events });
        const origCanClose = pane.canClose?.bind(pane);
        pane.canClose = async () => {
            if (!this.bypassClosePrompt && isTaskActiveExecution(task)) {
                const confirmed = await this.confirmClosingTasks([task]);
                if (!confirmed) return false;
            }
            return origCanClose ? origCanClose() : true;
        };
        events.add(() => { pane.canClose = origCanClose; });
        if (restored && isTrackedAiTask(task) && this.hasPersistedSession(task) && !pane.frontendIsReady && pane.savedState) {
            try { pane.savedState = null; } catch { /* Ignore readonly savedState. */ }
        }
        const origGetRecoveryToken = pane.getRecoveryToken?.bind(pane);
        if (origGetRecoveryToken) {
            pane.getRecoveryToken = async (options) => {
                const token = await origGetRecoveryToken(options);
                if (token && isTrackedAiTask(task) && this.hasPersistedSession(task)) {
                    token.savedState = null;
                }
                return token;
            };
            events.add(() => { pane.getRecoveryToken = origGetRecoveryToken; });
        }
        if (pane.profile && pane.profile.behaviorOnSessionEnd !== 'close') {
            try { pane.profile.behaviorOnSessionEnd = 'close'; } catch { /* Ignore readonly profile proxy. */ }
        }
        pane.icon = cliIcon(task.executable);
        this.setTaskStatus(task, pane.session?.open ? 'running' : 'starting');
        let sessionEvents: Subscription | undefined;
        let recentUpdateProbe = '';
        const enterSelfUpdate = (chunk = '') => {
            let state = this.updatingTasks.get(task.id);
            if (!state) {
                state = { startedAt: Date.now(), output: '' };
                this.updatingTasks.set(task.id, state);
            }
            if (chunk) state.output = (state.output + '\n' + stripTerminalEscapes(chunk)).slice(-4096);
            if (pane.profile && pane.profile.behaviorOnSessionEnd !== 'keep') {
                try { pane.profile.behaviorOnSessionEnd = 'keep'; } catch { /* Ignore readonly profile proxy. */ }
            }
            this.turnArmed.add(task.id);
            if (task.activity !== 'working') {
                this.zone.run(() => this.setActivity(task, 'working'));
            }
        };
        const shouldDiscardEmpty = () =>
            !task.error && !this.updatingTasks.has(task.id) && isTrackedAiTask(task) && !this.hasPersistedSession(task);
        const stopped = () => {
            if (this.restartingTasks.has(task.id) || this.updatingTasks.get(task.id)?.restarting) return;
            if (shouldDiscardEmpty()) {
                this.zone.run(() => this.discardEmptyTask(task));
                return;
            }
            this.zone.run(() => this.setTaskStatus(task, task.error ? 'failed' : 'stopped'));
        };
        const onSessionClosed = () => {
            if (this.restartingTasks.has(task.id)) return;
            const updateState = this.updatingTasks.get(task.id);
            if (updateState) {
                if (updateState.restarting) return;
                if (hasCliSelfUpdateFailure(updateState.output)) {
                    this.updatingTasks.delete(task.id);
                    this.zone.run(() => {
                        task.error = this.i18n.text('CLI 更新失败，请查看终端输出。', 'CLI update failed. Check terminal output.');
                        this.setTaskStatus(task, 'failed');
                    });
                    return;
                }
                updateState.restarting = true;
                this.zone.run(() => {
                    task.error = undefined;
                    task.activity = undefined;
                    this.setTaskStatus(task, 'starting');
                });
                const restartTimer = setTimeout(() => {
                    if (events.closed || this.bindings.get(task.id)?.pane !== pane) return;
                    this.updatingTasks.delete(task.id);
                    this.turnArmed.delete(task.id);
                    recentUpdateProbe = '';
                    if (pane.profile && pane.profile.behaviorOnSessionEnd !== 'close') {
                        try { pane.profile.behaviorOnSessionEnd = 'close'; } catch { /* Ignore readonly profile proxy. */ }
                    }
                    void this.restartUpdatedSessionInPlace(task, pane, events);
                }, 80);
                events.add(() => clearTimeout(restartTimer));
                return;
            }
            stopped();
            if (pane.profile?.behaviorOnSessionEnd !== 'close') {
                try { pane.destroy?.(); } catch { /* Ignore already-destroyed tab panes. */ }
            }
        };
        const watchSession = () => {
            sessionEvents?.unsubscribe();
            sessionEvents = new Subscription();
            if (pane.session?.open) this.zone.run(() => this.reviveTimeoutFailedTask(task));
            sessionEvents.add(pane.session?.closed$.subscribe(onSessionClosed));
            sessionEvents.add(pane.session?.destroyed$.subscribe(stopped));
        };
        watchSession();
        events.add(pane.sessionChanged$?.subscribe(watchSession));
        events.add(() => sessionEvents?.unsubscribe());
        let inputLine = '';
        const watchInput = () => events.add(pane.frontend?.input$?.subscribe(data => {
            if (task.status === 'starting' || (task.status === 'failed' && task.error === sessionOpenTimeoutMessage)) {
                this.zone.run(() => this.reviveTimeoutFailedTask(task));
            }
            const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '');
            if (/[\r\n]|\x1bOM|\x1b\[13;[0-9;]*u/.test(text)) {
                this.turnArmed.add(task.id);
                if (screenHasSelectedUpdateNow(pane.frontend?.xterm) || isCliSelfUpdateCommand(inputLine)) {
                    enterSelfUpdate();
                }
                inputLine = '';
                return;
            }
            if (text === '\x7f' || text === '\b') {
                inputLine = inputLine.slice(0, -1);
            } else if (text === '\x03' || text === '\x15' || text.startsWith('\x1b')) {
                inputLine = '';
                if ((text === '\x03' || text === '\x1b') && task.activity === 'working' && !this.updatingTasks.has(task.id)) {
                    const interruptTimer = setTimeout(() => {
                        if (events.closed || this.bindings.get(task.id)?.pane !== pane || this.updatingTasks.has(task.id)) return;
                        const screen = pane.frontend?.xterm;
                        if (!hasScreenInterrupt(screen) && !hasActiveFooterTasks(screen)) {
                            if (this.agyMeterActivities.get(task.id) === 'working') {
                                this.agyMeterActivities.set(task.id, 'ready');
                            }
                            this.zone.run(() => this.setActivity(task, 'ready'));
                        }
                    }, 180);
                    events.add(() => clearTimeout(interruptTimer));
                }
            } else if (/^[\x20-\x7e]+$/.test(text)) {
                inputLine = (inputLine + text).slice(-64);
            }
        }));
        if (pane.frontend?.input$) watchInput();
        else events.add(pane.frontendReady$?.subscribe(watchInput));
        let hasOscStatus = false;
        const cliExec = !task.codex ? (cliBrand(task.executable)?.executable ?? task.cliSession?.executable) : undefined;
        if (restored && (cliExec === 'agy' || cliExec === 'claude')) {
            void this.restoreAgyMeter(task, pane, events);
        }
        if (task.codex) {
            const watchTitle = () => events.add(pane.frontend?.title$.subscribe(title => {
                const { id, activity } = codexTerminalTitle(title);
                this.zone.run(() => {
                    const safeActivity = this.resolveTaskActivity(task, pane, activity);
                    const nextActivity = safeActivity === 'ready' && !hasScreenAbort(pane.frontend?.xterm)
                        && (task.error || task.detail?.hasError || codexScreenHasError(pane.frontend?.xterm))
                        ? 'error' : safeActivity;
                    this.setActivity(task, nextActivity);
                    if (!id || id === this.titleIds.get(task.id)) return;
                    this.titleIds.set(task.id, id);
                    if (task.codex?.sessionId && !task.codex.sessionId.toLowerCase().startsWith(id)) {
                        task.codex.sessionId = undefined;
                        task.detail = undefined;
                        this.saveTask(task);
                    }
                    void this.updateDetails(task, true);
                });
            }));
            const watchCodexScreen = () => {
                const screen = pane.frontend?.xterm;
                if (!screen?.onWriteParsed) return;
                let throttleTimer: ReturnType<typeof setTimeout> | undefined;
                let lastRun = 0;
                const runCheck = () => {
                    throttleTimer = undefined;
                    lastRun = Date.now();
                    if (this.updatingTasks.has(task.id) || this.restartingTasks.has(task.id)) return;
                    if (!this.turnArmed.has(task.id) && hasScreenAuthPrompt(screen)) {
                        this.authWaitingTasks.add(task.id);
                        if (task.activity !== 'waiting') this.zone.run(() => this.setActivity(task, 'waiting'));
                        return;
                    }
                    if (task.activity === 'working' && codexScreenIsIdle(screen)) {
                        const next = !hasScreenAbort(screen) && (task.error || task.detail?.hasError || codexScreenHasError(screen)) ? 'error' : 'ready';
                        this.zone.run(() => this.setActivity(task, next));
                    } else if (task.activity !== 'working' && hasScreenInterrupt(screen)) {
                        this.turnArmed.add(task.id);
                        this.zone.run(() => this.setActivity(task, 'working'));
                    } else if (this.authWaitingTasks.has(task.id) && codexScreenIsIdle(screen)) {
                        this.zone.run(() => this.setActivity(task, 'ready'));
                    }
                };
                this.zone.runOutsideAngular(() => {
                    const listener = screen.onWriteParsed(() => {
                        const elapsed = Date.now() - lastRun;
                        if (elapsed >= 100) {
                            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
                            runCheck();
                        } else if (!throttleTimer) {
                            throttleTimer = setTimeout(runCheck, 100 - elapsed);
                        }
                    });
                    events.add(() => {
                        if (throttleTimer) clearTimeout(throttleTimer);
                        listener.dispose();
                    });
                    runCheck();
                });
            };
            if (pane.frontend?.title$) watchTitle();
            else events.add(pane.frontendReady$?.subscribe(watchTitle));
            if (pane.frontend?.xterm) watchCodexScreen();
            else events.add(pane.frontendReady$?.subscribe(watchCodexScreen));
        } else {
            const executable = cliExec;
            if (executable === 'grok') {
                const watchGrokTitle = () => events.add(pane.frontend?.title$.subscribe(title => {
                    const titleActivity = this.resolveTaskActivity(task, pane, grokTerminalTitle(title));
                    if (titleActivity && titleActivity !== task.activity) {
                        this.zone.run(() => this.setActivity(task, titleActivity));
                    }
                }));
                if (pane.frontend?.title$) watchGrokTitle();
                else events.add(pane.frontendReady$?.subscribe(watchGrokTitle));
            }
            const readActivity = executable === 'opencode' ? openCodeActivity
                : executable === 'grok' ? grokActivity
                : executable === 'copilot' ? copilotActivity
                : executable === 'pi' || executable === 'agy' || executable === 'claude' || executable === 'kimi' ? terminalEditorActivity : undefined;
            if (readActivity) {
                const watchEditor = () => {
                    const screen = pane.frontend?.xterm;
                    if (!screen?.onWriteParsed) return;
                    let throttleTimer: ReturnType<typeof setTimeout> | undefined;
                    let lastRun = 0;
                    const runUpdate = () => {
                        throttleTimer = undefined;
                        lastRun = Date.now();
                        if (this.restartingTasks.has(task.id)) return;
                        if (hasScreenInterrupt(screen) || hasActiveFooterTasks(screen)) this.turnArmed.add(task.id);
                        if (!this.turnArmed.has(task.id) && !this.updatingTasks.has(task.id) && hasScreenAuthPrompt(screen)) {
                            this.authWaitingTasks.add(task.id);
                            if (task.activity !== 'waiting') this.zone.run(() => this.setActivity(task, 'waiting'));
                            return;
                        }
                        const activity = this.resolveTaskActivity(task, pane, readActivity(screen));
                        if (executable === 'agy' && task.detail?.quota) {
                            const meterActivity = this.agyMeterActivities.get(task.id);
                            const tasksRunning = meterActivity !== 'waiting' && hasActiveFooterTasks(screen);
                            const resolved = this.resolveTaskActivity(task, pane, tasksRunning ? 'working' : activity === 'error' ? 'error' : meterActivity);
                            if (resolved && resolved !== task.activity) this.zone.run(() => this.setActivity(task, resolved));
                            return;
                        }
                        if (hasOscStatus && activity !== 'error' && !(executable === 'grok' && activity === 'waiting')) return;
                        if (activity && activity !== task.activity) this.zone.run(() => this.setActivity(task, activity));
                        if (executable === 'pi') {
                            const live = piFooterDetails(screen);
                            if (live) {
                                this.piLiveDetail.set(task.id, live);
                                if (task.detail?.model !== live.model || task.detail?.effort !== live.effort
                                    || task.detail?.context?.percent !== live.context?.percent
                                    || task.detail?.context?.window !== live.context?.window) {
                                    this.zone.run(() => {
                                        task.detail = {
                                            ...task.detail,
                                            model: live.model ?? task.detail?.model,
                                            effort: live.model ? live.effort : (live.effort ?? task.detail?.effort),
                                            context: live.context ?? task.detail?.context,
                                            tokens: task.detail?.tokens ?? live.tokens,
                                        };
                                    });
                                }
                            }
                        }
                    };
                    this.zone.runOutsideAngular(() => {
                        const update = () => {
                            const elapsed = Date.now() - lastRun;
                            if (elapsed >= 100) {
                                if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
                                runUpdate();
                            } else if (!throttleTimer) {
                                throttleTimer = setTimeout(runUpdate, 100 - elapsed);
                            }
                        };
                        const listener = screen.onWriteParsed(update);
                        events.add(() => {
                            if (throttleTimer) clearTimeout(throttleTimer);
                            listener.dispose();
                        });
                        runUpdate();
                    });
                };
                if (pane.frontend?.xterm) watchEditor();
                else events.add(pane.frontendReady$?.subscribe(watchEditor));
            }
        }
        events.add(pane.destroyed$.subscribe(() => {
            const wasSelected = this.selected === task;
            const discard = shouldDiscardEmpty();
            this.release(task);
            if (discard) this.zone.run(() => this.discardEmptyTask(task));
            else stopped();
            if (wasSelected) this.watchFocus();
        }));
        let startupOutput = '';
        let oscRemainder = '';
        let oscProgressRemainder = '';
        events.add(pane.output$?.subscribe(output => {
            const plainChunk = stripTerminalEscapes(output);
            recentUpdateProbe = (recentUpdateProbe + plainChunk).slice(-1024);
            const activeUpdate = this.updatingTasks.get(task.id);
            if (activeUpdate) {
                activeUpdate.output = (activeUpdate.output + plainChunk).slice(-4096);
                if (Date.now() - activeUpdate.startedAt > 1500
                    && /\b(?:already\s+up\s+to\s+date|no\s+updates?\s+available|is\s+up\s+to\s+date)\b/i.test(activeUpdate.output)) {
                    this.updatingTasks.delete(task.id);
                    if (pane.profile && pane.profile.behaviorOnSessionEnd !== 'close') {
                        try { pane.profile.behaviorOnSessionEnd = 'close'; } catch { /* Ignore readonly profile proxy. */ }
                    }
                } else if (task.activity !== 'working') {
                    this.zone.run(() => this.setActivity(task, 'working'));
                }
            } else if (isCliSelfUpdateOutput(plainChunk) || isCliSelfUpdateOutput(recentUpdateProbe)) {
                enterSelfUpdate(plainChunk);
            }
            if (output.includes('7501;') || oscRemainder) {
                const combined = oscRemainder + output;
                let oscActivity = parseProgramStatusOsc(combined);
                if (oscActivity) hasOscStatus = true;
                if (oscActivity === 'ready' && !hasScreenAbort(pane.frontend?.xterm)
                    && (task.detail?.hasError || (pane.frontend?.xterm && terminalEditorActivity(pane.frontend.xterm) === 'error'))) {
                    oscActivity = 'error';
                }
                oscActivity = this.resolveTaskActivity(task, pane, oscActivity);
                if (oscActivity && oscActivity !== task.activity) {
                    this.zone.run(() => this.setActivity(task, oscActivity));
                }
                const lastEsc = combined.lastIndexOf('\x1b]7501;');
                oscRemainder = lastEsc >= 0 && combined.length - lastEsc < 256 ? combined.slice(lastEsc) : '';
            }
            if (cliExec === 'grok' && (output.includes('9;4;') || oscProgressRemainder)) {
                const combined = oscProgressRemainder + output;
                let progressActivity = parseProgressOsc(combined);
                if (progressActivity) hasOscStatus = true;
                if (progressActivity === 'ready' && !hasScreenAbort(pane.frontend?.xterm)
                    && (task.detail?.hasError || (pane.frontend?.xterm && grokActivity(pane.frontend.xterm) === 'error'))) {
                    progressActivity = 'error';
                }
                progressActivity = this.resolveTaskActivity(task, pane, progressActivity);
                if (progressActivity && progressActivity !== task.activity) {
                    this.zone.run(() => this.setActivity(task, progressActivity));
                }
                const lastEsc = combined.lastIndexOf('\x1b]9;4;');
                oscProgressRemainder = lastEsc >= 0 && combined.length - lastEsc < 64 ? combined.slice(lastEsc) : '';
            }
            if (task.codex?.sessionId && !this.turnArmed.has(task.id) && !task.error) {
                startupOutput = (startupOutput + output).slice(-2048);
                const provider = startupOutput.match(/account\/gatewayOAuth\/read failed:[\s\S]*?model provider\s+["“]([\w.-]+)["”][\s\S]*?no longer configured/i)?.[1];
                if (provider) this.zone.run(() => {
                    task.error = `当前账号缺少模型提供方 ${provider}。请用原配置恢复，或在会话历史中只读查看。`;
                    this.setActivity(task, 'error');
                });
            }
            if ((pane.session?.open || hasVisibleTerminalText(output))
                && (task.status === 'starting' || (task.status === 'failed' && task.error === sessionOpenTimeoutMessage))) {
                this.zone.run(() => this.reviveTimeoutFailedTask(task));
            }
            if (task.status === 'running' && hasVisibleTerminalText(output)) {
                if (shouldMarkTaskUnreadOnOutput(task, this.selected, output, this.blurredAt.get(task.id))) {
                    this.zone.run(() => {
                        task.unread = true;
                        this.treeVersion++;
                    });
                }
                if (this.isDefaultTaskName(task)) void this.updateDetails(task);
            }
        }));
        this.waitForSessionOpen(task, pane, events, restored);
    }

    private waitForSessionOpen(task: Task, pane: Tab, events: Subscription, restored = false): void {
        if (pane.session?.open) {
            this.zone.run(() => this.reviveTimeoutFailedTask(task));
            return;
        }
        this.zone.runOutsideAngular(() => {
            const deadline = Date.now() + 20000;
            const timer = setInterval(() => {
                const waitingRevive = task.status === 'starting' || (task.status === 'failed' && task.error === sessionOpenTimeoutMessage);
                if (!waitingRevive) return clearInterval(timer);
                if (pane.session?.open) {
                    this.zone.run(() => this.reviveTimeoutFailedTask(task));
                    clearInterval(timer);
                } else if (!restored && task.status === 'starting' && Date.now() >= deadline) {
                    this.zone.run(() => {
                        this.setTaskStatus(task, 'failed');
                        task.error = sessionOpenTimeoutMessage;
                    });
                }
            }, 250);
            events.add(() => clearInterval(timer));
        });
    }

    private async syncLivePaneProfile(task: Task, parentProject = this.projectFor(task), codexScopeDir?: string): Promise<void> {
        const pane = this.bindings.get(task.id)?.pane;
        if (!pane?.profile || !parentProject) return;
        const project = task.directory ? { ...parentProject, directory: task.directory } : parentProject;
        const nextTitle = `${task.name} · ${project.name}`;
        let dirty = false;
        try {
            if (pane.profile.name !== nextTitle) {
                pane.profile.name = nextTitle;
                dirty = true;
            }
        } catch { /* Ignore readonly profile proxy. */ }
        if (!pane.profile.options) {
            if (dirty) try { pane.recoveryStateChangedHint?.next(); } catch {}
            return;
        }
        const cli = configurableCli(task.executable);
        const brandExec = cliBrand(task.executable)?.executable;
        const dataDirectory = task.cliSession?.dataDirectory ?? task.dataDirectory;
        const baseEnv = cli && dataDirectory ? { [directoryVariables[cli]]: dataDirectory,
            ...(cli === 'kimi' ? { KIMI_SHARE_DIR: dataDirectory } : {}) } : undefined;
        const env = brandExec === 'pi' ? { ...baseEnv, PI_PROGRAM_STATUS: '1' } : baseEnv;
        let command: Command | undefined;
        if (task.codex) {
            if (!task.codex.sessionId) {
                if (dirty) try { pane.recoveryStateChangedHint?.next(); } catch {}
                return;
            }
            const directory = codexScopeDir ?? (await this.codex.scope(project.distro, task.codex.accountId).catch(() => undefined))?.directory;
            if (!directory) {
                if (dirty) try { pane.recoveryStateChangedHint?.next(); } catch {}
                return;
            }
            command = {
                executable: task.executable,
                codexHome: directory,
                args: ['-c', codexTitleOption, 'resume', task.codex.sessionId],
            };
        } else if (task.cliSession?.args?.length) {
            const resumeArgs = [...task.cliSession.args];
            const existingSettings = (brandExec === 'agy' || cli === 'claude')
                ? extractMeterSettingsArg(pane.profile.options)
                : undefined;
            const args = existingSettings && !resumeArgs.some(arg => /^--settings(?:=|$)/.test(arg))
                ? ['--settings', existingSettings, ...resumeArgs]
                : resumeArgs;
            command = env ? { executable: task.executable, args, env } : { executable: task.executable, args };
        }
        if (!command || this.bindings.get(task.id)?.pane !== pane) {
            if (dirty) try { pane.recoveryStateChangedHint?.next(); } catch {}
            return;
        }
        const nextOptions = commandFor(project, command);
        const targetOptions = pane.profile.options as Record<string, unknown>;
        try {
            // Tabby wraps pane.profile in ConfigProxy where `options` is a getter-only nested proxy;
            // mutating leaf keys (`command`, `args`, `cwd`, `env`) updates the real underlying config object.
            targetOptions.command = nextOptions.command;
            targetOptions.args = nextOptions.args;
            if (nextOptions.cwd !== undefined) targetOptions.cwd = nextOptions.cwd;
            if (nextOptions.env !== undefined) targetOptions.env = nextOptions.env;
            dirty = true;
        } catch {
            try {
                pane.profile.options = nextOptions;
                dirty = true;
            } catch { /* Keep existing profile options if readonly. */ }
        }
        if (dirty) {
            try { pane.recoveryStateChangedHint?.next(); } catch { /* Ignore if unavailable. */ }
        }
    }

    private authRuntimeKey(task: Task): string | undefined {
        const project = this.projectFor(task);
        if (!project) return undefined;
        const exec = task.codex ? 'codex' : (cliBrand(task.executable)?.executable ?? task.cliSession?.executable);
        if (!exec) return undefined;
        return `${project.distro?.toLowerCase() ?? 'windows'}|${exec}`;
    }

    private recoverSiblingAuthWaitingTasks(authenticatedTask: Task): void {
        const key = this.authRuntimeKey(authenticatedTask);
        if (!key) return;
        for (const other of this.tasks) {
            if (other.id === authenticatedTask.id) continue;
            if (!this.authWaitingTasks.has(other.id) || this.authRetriedTasks.has(other.id)) continue;
            if (this.turnArmed.has(other.id) || this.updatingTasks.has(other.id) || this.restartingTasks.has(other.id)) continue;
            if (this.authRuntimeKey(other) !== key) continue;
            const binding = this.bindings.get(other.id);
            if (!binding) continue;
            this.authRetriedTasks.add(other.id);
            this.authWaitingTasks.delete(other.id);
            void this.restartAuthSiblingInPlace(other, binding.pane, binding.events);
        }
    }

    private async restartAuthSiblingInPlace(task: Task, pane: Tab, events: Subscription): Promise<void> {
        if (events.closed || this.bindings.get(task.id)?.pane !== pane) return;
        this.restartingTasks.add(task.id);
        this.zone.run(() => {
            task.error = undefined;
            task.activity = undefined;
            this.setTaskStatus(task, 'starting');
        });
        if (pane.profile && pane.profile.behaviorOnSessionEnd !== 'keep') {
            try { pane.profile.behaviorOnSessionEnd = 'keep'; } catch {}
        }
        try {
            const oldSession = pane.session as (NonNullable<Tab['session']> & { destroy?(): Promise<void> | void }) | null | undefined;
            if (oldSession && typeof oldSession.destroy === 'function') {
                await Promise.resolve(oldSession.destroy()).catch(() => undefined);
            }
        } catch {}
        try {
            if (!events.closed && this.bindings.get(task.id)?.pane === pane) {
                await this.restartUpdatedSessionInPlace(task, pane, events);
            }
        } finally {
            this.restartingTasks.delete(task.id);
            if (pane.profile && pane.profile.behaviorOnSessionEnd !== 'close') {
                try { pane.profile.behaviorOnSessionEnd = 'close'; } catch {}
            }
        }
    }

    private async restartUpdatedSessionInPlace(task: Task, pane: Tab, events: Subscription): Promise<void> {
        const parent = this.projectFor(task);
        if (parent && pane.profile?.options) {
            try { await this.syncLivePaneProfile(task, parent); } catch { /* Keep existing profile options. */ }
        }
        if (events.closed || this.bindings.get(task.id)?.pane !== pane) return;
        const hostPane = pane as Tab & {
            size?: { columns?: number; rows?: number };
            initializeSession?: (columns: number, rows: number) => void;
            frontend?: { resetTerminalModes?: () => void; xterm?: TerminalScreen & { cols?: number } };
        };
        if (typeof hostPane.initializeSession === 'function') {
            const cols = hostPane.size?.columns ?? hostPane.frontend?.xterm?.cols ?? 80;
            const rows = hostPane.size?.rows ?? hostPane.frontend?.xterm?.rows ?? 30;
            try { hostPane.frontend?.resetTerminalModes?.(); } catch {}
            hostPane.initializeSession(cols, rows);
            this.waitForSessionOpen(task, pane, events);
            return;
        }
        this.release(task);
        this.setTaskStatus(task, 'stopped');
        try { pane.destroy?.(); } catch {}
        await this.start(task);
    }

    private setTaskStatus(task: Task, status: TaskStatus): void {
        task.status = status;
        if (status === 'stopped' || status === 'failed') {
            task.activity = undefined;
            task.unread = false;
        } else if (status === 'running' && !task.activity && isTrackedAiTask(task)) {
            task.activity = 'ready';
        }
        const pane = this.bindings.get(task.id)?.pane;
        if (pane) pane.color = statusColors[statusDisplay(task)];
        this.treeVersion++;
    }

    private setActivity(task: Task, activity?: CodexActivity): void {
        if (!activity || activity === task.activity || (task.status !== 'running' && task.status !== 'starting')) return;
        const previous = task.activity;
        task.activity = activity;
        if (activity === 'working' && task.detail?.hasError) task.detail.hasError = false;
        if (this.selected !== task && !task.unread && (
            activity === 'waiting'
            || ((previous === 'working' || previous === 'waiting') && (activity === 'ready' || activity === 'error'))
        )) {
            task.unread = true;
        }
        this.setTaskStatus(task, task.status);
        if (this.authWaitingTasks.has(task.id) && (activity === 'ready' || activity === 'working')) {
            this.authWaitingTasks.delete(task.id);
            this.recoverSiblingAuthWaitingTasks(task);
        }
        if (previous === 'working' || activity === 'working' || activity === 'ready' || activity === 'error') {
            task.lastActiveAt = Date.now();
            try { this.saveTask(task); } catch { /* The live status still applies. */ }
            void this.updateDetails(task, true);
        }
    }

    private isDefaultNameFor(executable: string, title: string): boolean {
        const name = title.trim();
        if (!name || name.startsWith('/')) return true;
        const lower = name.toLowerCase();
        const execLower = executable.toLowerCase();
        if (lower === execLower || lower === `${execLower} 会话`) return true;
        const brand = cliBrand(executable);
        if (!brand) return false;
        const brandLower = brand.name.toLowerCase();
        return lower === brandLower || lower === `${brandLower} 会话`;
    }

    private isDefaultTaskName(task: Task): boolean {
        return this.isDefaultNameFor(task.executable, task.name);
    }

    private async syncCliTaskSession(task: Task, project: Project, executable: CliSession['executable']): Promise<void> {
        const sessions = await this.cliHistory.listForCli(project, executable, 15);
        if (!sessions.length) return;
        const attached = new Set(this.tasksFor(project)
            .filter(other => other.id !== task.id)
            .map(other => this.taskSessionKey(other))
            .filter((key): key is string => Boolean(key)));
        const keyOf = (item: CliSession) => historyId(project.distro, item.directoryId ?? defaultAccount, item.id, item.executable);

        const liveAgyId = executable === 'agy' ? this.agyLiveSessionIds.get(task.id) : undefined;
        if (!task.cliSession || (liveAgyId && task.cliSession.id !== liveAgyId)) {
            if (task.status !== 'running') return;
            let matched: CliSession | undefined;
            if (liveAgyId) {
                matched = sessions.find(item => item.id === liveAgyId);
            } else if (!task.cliSession) {
                if (!this.turnArmed.has(task.id)) return;
                const excluded = this.newSessionExcludedKeys.get(task.id);
                const since = (task.startedAt ?? Date.now()) - 2000;
                matched = sessions.find(item => {
                    const key = keyOf(item);
                    return item.updatedAt >= since
                        && !attached.has(key)
                        && !excluded?.has(key)
                        && !this.removedSessions.some(rem => rem.sessionKey === key);
                });
            }
            if (!matched) return;
            this.newSessionExcludedKeys.delete(task.id);
            this.zone.run(() => {
                const switched = Boolean(task.cliSession && task.cliSession.id !== matched!.id);
                task.cliSession = matched;
                if (!task.args.length || switched || task.args[0] === matched!.args[0]) task.args = [...matched!.args];
                if (matched!.title && !this.isDefaultNameFor(task.executable, matched!.title) && (switched || this.isDefaultTaskName(task))) {
                    task.name = matched!.title;
                    this.bindings.get(task.id)?.pane.setTitle?.(`${task.name} · ${project.name}`);
                }
                task.lastActiveAt = Math.max(task.lastActiveAt ?? 0, matched!.updatedAt);
                this.saveTask(task);
                void this.syncLivePaneProfile(task, project);
                void this.loadRecentHistory(project);
            });
            return;
        }

        const fresh = sessions.find(item => item.id === task.cliSession?.id);
        if (!fresh) return;
        this.zone.run(() => {
            const prevUpdated = task.cliSession?.updatedAt ?? 0;
            const renamed = Boolean(fresh.title && !this.isDefaultNameFor(task.executable, fresh.title) && this.isDefaultTaskName(task));
            task.cliSession = { ...task.cliSession!, ...fresh };
            if (renamed) {
                task.name = fresh.title;
                this.bindings.get(task.id)?.pane.setTitle?.(`${task.name} · ${project.name}`);
            }
            if (renamed || fresh.updatedAt > prevUpdated) {
                task.lastActiveAt = Math.max(task.lastActiveAt ?? 0, fresh.updatedAt);
                this.saveTask(task);
                if (renamed) void this.syncLivePaneProfile(task, project);
                void this.loadRecentHistory(project);
            }
        });
    }

    private hasPersistedSession(task: Task): boolean {
        return Boolean(task.cliSession?.id || task.codex?.sessionId);
    }

    private discardEmptyTask(task: Task): void {
        this.release(task);
        const before = this.tasks.length;
        this.tasks = this.tasks.filter(item => item.id !== task.id);
        if (this.selected === task) this.selectTask(null);
        try {
            const records = load<TaskRecord>(tasksKey);
            const next = records.filter(entry => entry.id !== task.id);
            if (next.length !== records.length) {
                localStorage.setItem(tasksKey, JSON.stringify(next));
            }
        } catch { /* Ignore storage quota errors. */ }
        if (before !== this.tasks.length) this.treeVersion++;
        const project = this.projectFor(task);
        if (project) void this.loadRecentHistory(project);
    }

    private release(task: Task): void {
        this.bindings.get(task.id)?.events.unsubscribe();
        this.bindings.delete(task.id);
        this.blurredAt.delete(task.id);
        this.turnArmed.delete(task.id);
        this.newSessionExcludedKeys.delete(task.id);
        this.agyLiveSessionIds.delete(task.id);
        this.authWaitingTasks.delete(task.id);
        this.authRetriedTasks.delete(task.id);
        this.restartingTasks.delete(task.id);
        this.updatingTasks.delete(task.id);
        this.titleIds.delete(task.id);
        this.claudeTranscripts.delete(task.id);
        this.agyMeterActivities.delete(task.id);
        this.piLiveDetail.delete(task.id);
        this.detailTime.delete(task.id);
    }

    private saveTask(task: Task): void {
        this.treeVersion++;
        const { id, projectId, name, executable, args, codex, directory, cliSession, lastActiveAt, dataDirectory } = task;
        save<TaskRecord>(tasksKey, { id, projectId, name, executable, args, codex, directory, cliSession, lastActiveAt, dataDirectory });
    }

    private async updateDetails(task: Task, force = false): Promise<void> {
        const codex = task.codex;
        const executable = task.cliSession?.executable ?? cliBrand(task.executable)?.executable;
        const extExec = !codex && (executable === 'agy' || executable === 'pi' || executable === 'claude' || executable === 'kimi' || executable === 'opencode' || executable === 'grok' || executable === 'copilot')
            ? executable
            : undefined;
        const project = this.projectFor(task);
        if ((!codex && !extExec) || !project || this.detailPending.has(task.id)) return;
        if (!force && Date.now() - (this.detailTime.get(task.id) ?? 0) < 4000) return;
        this.detailTime.set(task.id, Date.now());
        this.detailPending.add(task.id);
        try {
            if (extExec) {
                if (!task.cliSession || this.isDefaultTaskName(task) || force) {
                    await this.syncCliTaskSession(task, project, extExec);
                }
                const cli = task.cliSession;
                if (!cli) return;
                if (cli.executable === 'opencode' && !force && task.detail?.tokens !== undefined) return;
                const detail = await this.cliHistory.details(cli);
                if (detail && task.cliSession === cli) this.zone.run(() => {
                    const live = cli.executable === 'pi' ? this.piLiveDetail.get(task.id) : undefined;
                    task.detail = cli.executable === 'agy'
                        ? {
                            ...task.detail,
                            model: task.detail?.model ?? detail.model,
                            effort: task.detail?.effort ?? detail.effort,
                            context: task.detail?.context ?? detail.context,
                            tokens: detail.tokens ?? task.detail?.tokens,
                            hasError: detail.hasError,
                        }
                        : cli.executable === 'claude'
                        ? {
                            ...task.detail,
                            model: task.detail?.model ?? detail.model,
                            effort: task.detail?.effort ?? detail.effort,
                            context: task.detail?.context ?? detail.context,
                            tokens: detail.tokens ?? task.detail?.tokens,
                            hasError: detail.hasError,
                        }
                        : cli.executable === 'pi'
                        ? {
                            ...detail,
                            model: live?.model ?? detail.model ?? task.detail?.model,
                            effort: live?.model ? live.effort : (detail.effort ?? task.detail?.effort),
                            context: live?.context ?? detail.context ?? task.detail?.context,
                            tokens: detail.tokens ?? task.detail?.tokens ?? live?.tokens,
                        }
                        : detail;
                    if (detail.hasError && task.status === 'running' && task.activity !== 'working' && task.activity !== 'waiting' && task.activity !== 'error') {
                        task.activity = 'error';
                        this.setTaskStatus(task, task.status);
                    }
                    this.treeVersion++;
                });
                return;
            }
            if (!codex) return;
            const scope = await this.codex.scope(project.distro, codex.accountId);
            const marker = this.titleIds.get(task.id);
            const cwd = task.directory ?? project.directory;
            let sessionId = codex.sessionId;
            if (marker && !sessionId && task.status === 'running') sessionId = await this.codex.match(scope, cwd, marker);
            if (!sessionId && task.status === 'running' && this.turnArmed.has(task.id)) {
                const recent = await this.codex.history(scope, cwd, 10, true);
                const attached = new Set(this.tasksFor(project)
                    .filter(other => other.id !== task.id)
                    .map(other => this.taskSessionKey(other))
                    .filter((key): key is string => Boolean(key)));
                const excluded = this.newSessionExcludedKeys.get(task.id);
                const since = (task.startedAt ?? Date.now()) - 2000;
                const matched = recent.find(entry => {
                    const key = this.entryKey(entry);
                    return entry.updatedAt >= since && !attached.has(key) && !excluded?.has(key) && !this.isHistoryRemoved(entry);
                });
                sessionId = matched?.id;
                if (sessionId) this.newSessionExcludedKeys.delete(task.id);
            }
            const detail = await this.codex.details(scope, sessionId);
            if (this.titleIds.get(task.id) !== marker) return;
            this.zone.run(() => {
                let changed = false;
                if (sessionId && sessionId !== codex.sessionId) {
                    codex.sessionId = sessionId;
                    changed = true;
                    const removal = this.removedSessions.find(item => item.taskId === task.id && !item.sessionKey);
                    if (removal) {
                        save(removedSessionsKey, { ...removal, sessionKey: this.taskSessionKey(task) });
                        this.removedSessions = load(removedSessionsKey);
                    }
                }
                if (sessionId && detail?.summary && !detail.summary.startsWith('/') && this.isDefaultTaskName(task)) {
                    task.name = detail.summary;
                    this.bindings.get(task.id)?.pane.setTitle?.(`${task.name} · ${project.name}`);
                    changed = true;
                }
                if (changed) {
                    this.saveTask(task);
                    void this.syncLivePaneProfile(task, project, scope.directory);
                    void this.loadRecentHistory(project);
                }
                task.detail = detail;
                if (detail?.hasError && task.status === 'running' && task.activity !== 'working' && task.activity !== 'waiting' && task.activity !== 'error') {
                    task.activity = 'error';
                    this.setTaskStatus(task, task.status);
                }
                this.treeVersion++;
            });
        } catch { /* Account and session metadata can be temporarily unavailable. */ }
        finally { this.detailPending.delete(task.id); }
    }

    private async bindClaudeTranscript(task: Task, project: Project, id: string, transcript: string, dataDirectory?: string): Promise<void> {
        try {
            const path = project.distro ? posix : win32;
            const home = dataDirectory ?? (await this.cliDirectories.homes(project.distro)).claude;
            if (path.basename(transcript).toLowerCase() !== id.toLowerCase() + '.jsonl'
                || !withinProject(transcript, path.join(home, 'projects'), project.distro)) return;
            const [promptFile, scopes] = await Promise.all([localReadPath(transcript, project.distro),
                this.cliDirectories.scopes('claude', project.distro)]);
            if (this.claudeTranscripts.get(task.id) !== transcript) return;
            this.zone.run(() => {
                const scope = scopes.find(item => equalPath(item.directory, home, project.distro));
                task.cliSession = { id, cwd: project.directory, title: task.name, executable: 'claude', args: ['--resume', id],
                    dataDirectory: home, directoryId: scope?.id,
                    promptFile, updatedAt: Date.now() };
                if (!task.args.length || (task.args.length === 2 && task.args[0] === '--resume')) task.args = task.cliSession.args;
                this.saveTask(task);
                void this.syncLivePaneProfile(task, project);
                void this.updateDetails(task, true);
            });
        } catch {
            if (this.claudeTranscripts.get(task.id) === transcript) this.claudeTranscripts.delete(task.id);
        }
    }

    private async refreshBranch(project: Project): Promise<void> {
        const branch = await gitBranch(project);
        this.zone.run(() => {
            if (this.branches.get(project.id) !== branch) {
                this.branches.set(project.id, branch);
                this.treeVersion++;
            }
        });
    }

    ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
        this.focusSubscription?.unsubscribe();
        for (const binding of this.bindings.values()) binding.events.unsubscribe();
    }
}
