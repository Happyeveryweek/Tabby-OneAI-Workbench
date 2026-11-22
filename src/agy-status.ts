import { json } from './codex-data';
import type { QuotaWindow, SessionDetails } from './codex-data';
import type { CodexActivity } from './codex';

export interface AgyStatus {
    detail: SessionDetails;
    activity?: CodexActivity;
    sessionId?: string;
    transcript?: string;
}

function count(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseAgyStatus(text: string, now = Date.now()): AgyStatus | undefined {
    const data = json(text);
    if (!data || data.product !== 'antigravity') return;
    const modelName = [data.model?.display_name, data.model?.id].find(value => typeof value === 'string' && value.trim())?.trim();
    const suffix = modelName?.match(/\s*\((low|medium|high|xhigh|max)\)$/i);
    const effort = typeof data.model?.effort === 'string' && /^(low|medium|high|xhigh|max)$/i.test(data.model.effort)
        ? data.model.effort.toLowerCase() : suffix?.[1].toLowerCase();
    const model = (suffix ? modelName.slice(0, suffix.index) : modelName)?.slice(0, 120);
    const ctx = data.context_window;
    const input = count(ctx?.total_input_tokens);
    const output = count(ctx?.total_output_tokens);
    const window = count(ctx?.context_window_size) || undefined;
    const rawUsed = count(ctx?.used_percentage);
    const rawRemaining = count(ctx?.remaining_percentage);
    const current = count(ctx?.current_usage?.input_tokens);
    const currentTotal = current === undefined ? undefined
        : current + (count(ctx?.current_usage?.cache_read_input_tokens) ?? 0) + (count(ctx?.current_usage?.cache_creation_input_tokens) ?? 0);
    const used = rawUsed ?? (rawRemaining !== undefined ? Math.max(0, 100 - rawRemaining)
        : (window && currentTotal !== undefined ? (currentTotal * 100) / window : undefined));
    const percent = used === undefined ? undefined : Math.min(100, Math.round(used * 10) / 10);
    const context = percent !== undefined || currentTotal !== undefined ? {
        percent, window,
        tokens: window && used !== undefined ? Math.round(window * used / 100) : currentTotal,
    } : undefined;
    const bucket = (id: string): QuotaWindow | undefined => {
        const item = data.quota?.[id];
        const fraction = count(item?.remaining_fraction);
        if (item?.disabled || fraction === undefined || fraction > 1) return;
        const seconds = count(item?.reset_in_seconds);
        const reset = typeof item?.reset_time === 'string' ? Date.parse(item.reset_time) : NaN;
        return { remaining: Math.round(fraction * 1000) / 10,
            resetsAt: Number.isFinite(reset) ? reset : seconds === undefined ? undefined : now + seconds * 1000 };
    };
    const modelIdentity = [modelName, typeof data.model?.id === 'string' ? data.model.id : ''].join(' ');
    const modelFamily = /\b(?:gemini|argon|hydrogen|neon)\b/i.test(modelIdentity) ? 'gemini'
        : /\b(?:claude|gpt|sonnet|opus|haiku)\b/i.test(modelIdentity) || modelIdentity.trim() ? '3p' : undefined;
    const argonWeekly = modelFamily === 'gemini' && /\bargon\b/i.test(modelIdentity) ? bucket('gemini-argon-wtu-weekly') : undefined;
    const fiveHour = modelFamily && !argonWeekly ? (bucket(modelFamily + '-5h') ?? bucket('gemini-5h')) : undefined;
    const weekly = argonWeekly ?? (modelFamily ? (bucket(modelFamily + '-weekly') ?? bucket('gemini-weekly')) : undefined);
    const quota = fiveHour || weekly ? { fiveHour, weekly, source: 'agy' as const, updatedAt: now } : undefined;
    const runningSubagents = Array.isArray(data.subagents)
        ? data.subagents.filter(agent => {
            const st = typeof (agent as { status?: unknown } | null)?.status === 'string'
                ? ((agent as { status: string }).status).toLowerCase()
                : '';
            return st === 'running' || st === 'working' || st === 'thinking' || st === 'in_progress';
        }).length
        : (count(data.active_subagents) ?? count(data.running_subagents) ?? 0);
    const bgTasks = (count(data.task_count) ?? count(data.active_tasks) ?? count(data.background_tasks) ?? count(data.running_tasks) ?? 0)
        + runningSubagents;
    const activity = data.tool_confirmation_pending ? 'waiting'
        : (['thinking', 'working', 'tool_use'].includes(data.agent_state) || bgTasks > 0) ? 'working'
        : data.agent_state === 'idle' ? 'ready' : undefined;
    const rawSessionId = [data.conversation_id, data.session_id].find(value => typeof value === 'string' && value.trim())?.trim();
    const sessionId = rawSessionId && /^[a-zA-Z0-9._-]+$/.test(rawSessionId) ? rawSessionId : undefined;
    return {
        detail: { model, effort, context, quota, tokens: input === undefined && output === undefined ? undefined : (input ?? 0) + (output ?? 0) },
        activity,
        sessionId,
    };
}
