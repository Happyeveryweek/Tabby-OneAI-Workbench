import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type WorkbenchLanguage = 'zh' | 'en';

const languageKey = 'tabby-oneai.appearance.language.v1';

export function loadWorkbenchLanguage(): WorkbenchLanguage {
    try {
        return localStorage.getItem(languageKey) === 'en' ? 'en' : 'zh';
    } catch {
        return 'zh';
    }
}

export function t(zh: string, en: string): string {
    return loadWorkbenchLanguage() === 'en' ? en : zh;
}

export function formatTimestamp(ts?: number): string {
    if (!ts || !Number.isFinite(ts)) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatShortDate(ts?: number): string {
    if (!ts || !Number.isFinite(ts)) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return ts >= today.getTime()
        ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
        : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const statusLabelsEn = {
    starting: 'Starting',
    running: 'Running',
    working: 'Running',
    ready: 'Ready',
    waiting: 'Waiting',
    online: 'Online',
    error: 'Error',
    stopped: 'Exited',
    failed: 'Failed',
} as const;

const statusLabelsZh = {
    starting: '启动中',
    running: '运行中',
    working: '运行中',
    ready: '就绪',
    waiting: '等待确认',
    online: '在线',
    error: '异常',
    stopped: '已退出',
    failed: '失败',
} as const;

const themeLabelsEn: Record<string, string> = {
    light: 'Light',
    dark: 'Dark',
    bean: 'Sage Green',
    lavender: 'Lavender',
    mist: 'Mist Gray',
    nord: 'Nordic Slate',
    forest: 'Forest Night',
    ink: 'Ink Night',
};

const hotkeyNamesEn: Record<string, string> = {
    'oneai-open-history': 'View session prompts',
    'oneai-open-usage': 'View session usage',
    'oneai-open-settings': 'Open workbench settings',
    'oneai-toggle-sidebar': 'Toggle workbench sidebar',
};

@Injectable()
export class WorkbenchI18n {
    private readonly changed = new BehaviorSubject<WorkbenchLanguage>(loadWorkbenchLanguage());
    readonly changed$ = this.changed.asObservable();
    lang: WorkbenchLanguage = this.changed.value;

    get isEn(): boolean { return this.lang === 'en'; }

    setLanguage(lang: WorkbenchLanguage): void {
        if (this.lang === lang) return;
        localStorage.setItem(languageKey, lang);
        this.lang = lang;
        this.changed.next(lang);
    }

    text(zh: string, en: string): string {
        return this.lang === 'en' ? en : zh;
    }

    statusLabel(status: keyof typeof statusLabelsEn): string {
        return this.lang === 'en' ? statusLabelsEn[status] : statusLabelsZh[status];
    }

    themeLabel(id: string, defaultLabel: string): string {
        return this.lang === 'en' ? (themeLabelsEn[id] ?? defaultLabel) : defaultLabel;
    }

    hotkeyName(id: string, defaultName: string): string {
        return this.lang === 'en' ? (hotkeyNamesEn[id] ?? defaultName) : defaultName;
    }

    monthLabel(monthNumber: number): string {
        if (this.lang !== 'en') return `${monthNumber}月`;
        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return names[monthNumber - 1] ?? String(monthNumber);
    }

    weekdayList(): string[] {
        return this.lang === 'en'
            ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            : ['一', '二', '三', '四', '五', '六', '日'];
    }
}
