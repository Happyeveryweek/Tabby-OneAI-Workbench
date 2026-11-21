import { Inject, Injectable } from '@angular/core';
import { HotkeyProvider } from './host';
import { WorkbenchI18n } from './i18n';

const altName = process.platform === 'darwin' ? '⌥' : 'Alt';
const metaName = process.platform === 'darwin' ? '⌘' : process.platform === 'win32' ? 'Win' : 'Super';
const latinKeyRegex = /^[A-Za-z]$/;
const codeKeyMap: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    IntlBackslash: '`',
    Minus: '-',
    Equal: '=',
    Semicolon: ';',
    Quote: '\'',
    BracketLeft: '[',
    BracketRight: ']',
};

export const workbenchHotkeys = [
    { id: 'oneai-open-history', name: '查看会话提示词', action: 'history', defaultKeys: [`Ctrl-${altName}-Shift-H`] },
    { id: 'oneai-open-usage', name: '查看会话用量', action: 'usage', defaultKeys: [`Ctrl-${altName}-Shift-U`] },
    { id: 'oneai-open-settings', name: '打开工作台设置', action: 'settings', defaultKeys: [`Ctrl-${altName}-Shift-O`] },
    { id: 'oneai-toggle-sidebar', name: '折叠或展开工作台侧栏', action: 'sidebar', defaultKeys: [`Ctrl-${altName}-Shift-B`] },
] as const;

export function keyboardEventToTabbyStroke(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>): string | undefined {
    if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') return undefined;
    const modifiers: string[] = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.metaKey) modifiers.push(metaName);
    if (event.altKey) modifiers.push(altName);
    if (event.shiftKey) modifiers.push('Shift');

    let key = event.code ?? '';
    if (event.key === '`' || event.key === '~') {
        key = event.key;
    } else if (event.key && latinKeyRegex.test(event.key)) {
        key = event.key.toUpperCase();
    } else {
        key = key.replace('Key', '').replace('Arrow', '').replace('Digit', '');
        key = codeKeyMap[key] ?? key;
    }
    if (!key) return undefined;
    return [...modifiers, key].join('-');
}

@Injectable()
export class WorkbenchHotkeyProvider extends HotkeyProvider {
    constructor(@Inject(WorkbenchI18n) private readonly i18n: WorkbenchI18n) { super(); }

    async provide() {
        const prefix = this.i18n.text('AI 工作台', 'AI Workbench');
        return workbenchHotkeys.map(({ id, name }) => ({ id, name: `${prefix} · ${this.i18n.hotkeyName(id, name)}` }));
    }
}
