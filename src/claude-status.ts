import { clip, json, sessionIdPattern } from './codex-data';
import type { QuotaWindow, SessionDetails } from './codex-data';

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export function parseClaudeStatus(text: string, now = Date.now()) {
    const data = json(text);
    if (!data || typeof data.session_id !== 'string' || !sessionIdPattern.test(data.session_id)) return;
    const window = data.context_window;
    const used = count(window?.used_percentage);
    const input = count(window?.current_usage?.input_tokens);
    const limits = (item: { used_percentage?: number; resets_at?: number } | undefined): QuotaWindow | undefined => {
        const used = count(item?.used_percentage);
        const reset = count(item?.resets_at);
        return used === undefined ? undefined : { remaining: Math.max(0, Math.round((100 - used) * 10) / 10),
            resetsAt: reset ? reset * 1000 : undefined };
    };
    const fiveHour = limits(data.rate_limits?.five_hour);
    const weekly = limits(data.rate_limits?.seven_day);
    const detail: SessionDetails = {
        model: clip(data.model?.display_name) || clip(data.model?.id) || undefined,
        effort: clip(data.effort?.level) || undefined,
        context: used === undefined && input === undefined ? undefined : {
            window: count(window?.context_window_size),
            percent: used === undefined ? undefined : Math.min(100, Math.round(used * 10) / 10),
            tokens: input === undefined ? undefined : input + (count(window.current_usage.cache_read_input_tokens) ?? 0)
                + (count(window.current_usage.cache_creation_input_tokens) ?? 0),
        },
        quota: fiveHour || weekly ? { fiveHour, weekly, source: 'claude', updatedAt: now } : undefined,
    };
    return { detail, sessionId: data.session_id, transcript: typeof data.transcript_path === 'string' ? data.transcript_path : undefined };
}
