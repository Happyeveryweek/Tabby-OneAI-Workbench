import type { UsageEntry } from './codex-data';
import type { WorkbenchLanguage } from './i18n';

export type UsagePeriod = 'year' | 'month' | 'week';

export interface SessionUsageRows {
    id: string;
    entries: UsageEntry[];
}

export interface UsageTotals {
    input: number;
    cached: number;
    output: number;
    tokens: number;
}

export interface ModelUsageRow extends UsageTotals {
    model: string;
    share: number;
    color: string;
}

export interface DailyUsageCell extends UsageTotals {
    date: string;
    level: number;
    visible: boolean;
}

export interface DailySeriesBar extends UsageTotals {
    date: string;
    label: string;
    showLabel: boolean;
    percent: number;
}

export const usagePeriods: { id: UsagePeriod; label: string; enLabel: string }[] = [
    { id: 'year', label: '近 12 个月', enLabel: 'Last 12 Months' },
    { id: 'month', label: '本月', enLabel: 'This Month' },
    { id: 'week', label: '本周', enLabel: 'This Week' },
];

const modelPalette = ['#38bdf8', '#34d399', '#a78bfa', '#fb923c', '#f472b6', '#60a5fa', '#fbbf24', '#2dd4bf'];
const shortWeekdays = ['日', '一', '二', '三', '四', '五', '六'];
const shortWeekdaysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortMonthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dateKey = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(value => String(value).padStart(2, '0')).join('-');
const emptyTotals = (): UsageTotals => ({ input: 0, cached: 0, output: 0, tokens: 0 });

function colorForModel(model: string, index: number): string {
    return modelPalette[index % modelPalette.length];
}

export function summarizeUsage(rows: SessionUsageRows[], model: string, period: UsagePeriod, now = new Date(), lang: WorkbenchLanguage = 'zh') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const year = new Date(today);
    year.setDate(year.getDate() - 364);
    const week = new Date(today);
    week.setDate(week.getDate() - (week.getDay() + 6) % 7);
    const starts: Record<UsagePeriod, Date> = {
        year,
        month: new Date(today.getFullYear(), today.getMonth(), 1),
        week,
    };
    const models = new Map<string, UsageTotals>();
    const daily = new Map<string, UsageTotals>();
    const periodTotals = emptyTotals();
    const summaries = usagePeriods.map(item => ({
        ...item,
        start: starts[item.id],
        sessions: new Set<string>(),
        days: new Set<string>(),
        tokens: 0,
    }));

    for (const { id, entries } of rows) {
        for (const entry of entries) {
            if (entry.date > +now || entry.date < +year || (model && entry.model !== model)) continue;
            const tokens = entry.input + entry.cached + entry.output;
            const key = dateKey(new Date(entry.date));
            for (const summary of summaries) {
                if (entry.date < +summary.start) continue;
                summary.tokens += tokens;
                summary.sessions.add(id);
                summary.days.add(key);
            }
            if (entry.date < +starts[period]) continue;
            periodTotals.input += entry.input;
            periodTotals.cached += entry.cached;
            periodTotals.output += entry.output;
            periodTotals.tokens += tokens;

            const dayTotal = daily.get(key) ?? emptyTotals();
            dayTotal.input += entry.input;
            dayTotal.cached += entry.cached;
            dayTotal.output += entry.output;
            dayTotal.tokens += tokens;
            daily.set(key, dayTotal);

            const modelTotal = models.get(entry.model) ?? emptyTotals();
            modelTotal.input += entry.input;
            modelTotal.cached += entry.cached;
            modelTotal.output += entry.output;
            modelTotal.tokens += tokens;
            models.set(entry.model, modelTotal);
        }
    }

    const start = starts[period];
    const peak = Math.max(0, ...[...daily.values()].map(item => item.tokens));
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - (cursor.getDay() + 6) % 7);
    const weeks: { date: string; month: string; days: DailyUsageCell[] }[] = [];
    let lastMonthWeek = -99;
    while (cursor <= today) {
        const weekIndex = weeks.length;
        const date = dateKey(cursor);
        let month = '';
        const days = Array.from({ length: 7 }, (_, dayIndex) => {
            const isVisible = cursor >= start && cursor <= today;
            if (isVisible && ((weekIndex === 0 && dayIndex === 0) || cursor.getDate() === 1) && weekIndex - lastMonthWeek >= 3) {
                month = lang === 'en' ? (shortMonthsEn[cursor.getMonth()] ?? String(cursor.getMonth() + 1)) : `${cursor.getMonth() + 1}月`;
                lastMonthWeek = weekIndex;
            }
            const key = dateKey(cursor);
            const rec = isVisible ? (daily.get(key) ?? emptyTotals()) : emptyTotals();
            const level = rec.tokens && peak > 0 ? Math.min(4, Math.ceil(4 * Math.sqrt(rec.tokens / peak))) : 0;
            cursor.setDate(cursor.getDate() + 1);
            return { date: key, ...rec, level, visible: isVisible };
        });
        weeks.push({ date, month, days });
    }

    const rawSeries: Omit<DailySeriesBar, 'showLabel'>[] = [];
    const dayCursor = new Date(start);
    while (dayCursor <= today) {
        const key = dateKey(dayCursor);
        const rec = daily.get(key) ?? emptyTotals();
        const label = period === 'week'
            ? (lang === 'en' ? `${shortWeekdaysEn[dayCursor.getDay()]} ${dayCursor.getMonth() + 1}/${dayCursor.getDate()}` : `周${shortWeekdays[dayCursor.getDay()]} ${dayCursor.getMonth() + 1}/${dayCursor.getDate()}`)
            : (lang === 'en' ? String(dayCursor.getDate()) : `${dayCursor.getDate()}日`);
        const percent = peak > 0 && rec.tokens > 0 ? Math.max(7, Math.round((rec.tokens / peak) * 100)) : 0;
        rawSeries.push({ date: key, label, ...rec, percent });
        dayCursor.setDate(dayCursor.getDate() + 1);
    }
    const seriesLen = rawSeries.length;
    const daySeries: DailySeriesBar[] = rawSeries.map((item, idx) => ({
        ...item,
        showLabel: seriesLen <= 10 || idx === 0 || idx === seriesLen - 1 || idx % 3 === 0,
    }));

    const mappedSummaries = summaries.map(item => ({
        id: item.id,
        label: lang === 'en' ? item.enLabel : item.label,
        tokens: item.tokens,
        sessions: item.sessions.size,
        days: item.days.size,
        range: lang === 'en' ? `${dateKey(item.start)} to ${dateKey(today)}` : `${dateKey(item.start)} 至 ${dateKey(today)}`,
    }));
    const activeSummary = mappedSummaries.find(item => item.id === period) ?? mappedSummaries[0];
    const sortedModels: ModelUsageRow[] = [...models]
        .map(([name, usage]) => ({ model: name, ...usage }))
        .sort((a, b) => b.tokens - a.tokens)
        .map((item, idx) => ({
            ...item,
            share: periodTotals.tokens > 0 ? (item.tokens / periodTotals.tokens) * 100 : 0,
            color: colorForModel(item.model, idx),
        }));

    return {
        weeks,
        daySeries,
        peak,
        totals: periodTotals,
        cacheRate: periodTotals.tokens > 0 ? (periodTotals.cached / periodTotals.tokens) * 100 : 0,
        activeSessions: activeSummary.sessions,
        activeDays: activeSummary.days,
        dailyAverage: activeSummary.days > 0 ? Math.round(periodTotals.tokens / activeSummary.days) : 0,
        range: activeSummary.range,
        summaries: mappedSummaries,
        models: sortedModels,
    };
}
