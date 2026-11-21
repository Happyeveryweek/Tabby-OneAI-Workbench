import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject, merge } from 'rxjs';
import { ConfigService } from './host';
import type { HostConfig } from './host';

// Palette values from OneAI, adapted to plugin surfaces. See THIRD_PARTY_NOTICES.md.
const colorRoles = [
    'canvas', 'surface', 'panel', 'elevated', 'muted', 'control', 'control-hover', 'hover', 'selected', 'line', 'line-strong',
    'fg', 'fg-muted', 'fg-subtle', 'fg-faint', 'accent', 'primary', 'primary-hover', 'success', 'warning', 'danger', 'violet',
] as const;

export const palettes = [
    { id: 'light', label: '浅色', group: 'basic', mode: 'light',
        colors: ['#ffffff', '#f6f8fa', '#f0f3f6', '#ffffff', '#f6f8fa', '#eaeef2', '#d8dee4', '#eaeef2', '#ddf0ff', '#d0d7de', '#afb8c1',
            '#1f2328', '#424a53', '#59636e', '#6e7781', '#0969da', '#0969da', '#0858ba', '#1a7f37', '#9a6700', '#cf222e', '#8250df'] },
    { id: 'dark', label: '深色', group: 'basic', mode: 'dark',
        colors: ['#0d1117', '#111821', '#141d27', '#151e28', '#1b2532', '#263443', '#344657', '#212e3c', '#1d3447', '#263341', '#344453',
            '#e2e8f0', '#cbd5e1', '#94a3b8', '#7a899e', '#38bdf8', '#0284c7', '#0ea5e9', '#34d399', '#fbbf24', '#fb7185', '#c084fc'] },
    { id: 'bean', label: '豆沙绿', group: 'eyecare', mode: 'light',
        colors: ['#cce8cf', '#c0dec4', '#b8d6bc', '#d8eedb', '#c0dec4', '#b0ceb4', '#a0c0a5', '#b8d6bc', '#96c8a0', '#a0bea5', '#78967e',
            '#223226', '#344838', '#425846', '#4c6250', '#0e5e8a', '#0e5e8a', '#0a4c70', '#146e32', '#8c5a00', '#b91c28', '#6e40be'] },
    { id: 'lavender', label: '薰衣草', group: 'eyecare', mode: 'light',
        colors: ['#ece8f4', '#e5e0ef', '#ddd7ea', '#f4f1fa', '#e5e0ef', '#d4cee4', '#c6bfda', '#ddd7ea', '#cdd4f0', '#cdc6e0', '#a098be',
            '#2c263e', '#463e5e', '#544c6e', '#5c5476', '#4252b2', '#4252b2', '#324096', '#1e6e46', '#8c5a00', '#b9233c', '#703eb4'] },
    { id: 'mist', label: '雾灰', group: 'eyecare', mode: 'light',
        colors: ['#e4e9ee', '#dce2e8', '#d4dbe2', '#eef2f6', '#dce2e8', '#cad2db', '#bcc6d1', '#d4dbe2', '#bed3e8', '#c6cfd8', '#96a3b1',
            '#212a34', '#3a4654', '#485462', '#525e6c', '#146096', '#146096', '#0e4e7c', '#18703c', '#8e5c00', '#be2832', '#7046b4'] },
    { id: 'nord', label: '北极灰蓝', group: 'eyecare', mode: 'dark',
        colors: ['#2e3440', '#323946', '#373e4d', '#3b4252', '#3b4252', '#434c5e', '#4c566a', '#3f4758', '#42546e', '#434c5e', '#566176',
            '#e5e9f0', '#d8dee9', '#a7b0c0', '#8c96a8', '#88c0d0', '#5e81ac', '#81a1c1', '#a3be8c', '#ebcb8b', '#d77882', '#b48ead'] },
    { id: 'forest', label: '森夜', group: 'eyecare', mode: 'dark',
        colors: ['#181f1b', '#1d2520', '#222b25', '#27312a', '#2b362e', '#344138', '#425247', '#2b362e', '#2c4c3a', '#2e3a32', '#46584c',
            '#d6e2d6', '#bcccbe', '#96a89a', '#7e9082', '#7ec896', '#308254', '#3e9c66', '#8ccd82', '#e2be64', '#e87c76', '#b896d8'] },
    { id: 'ink', label: '墨夜', group: 'eyecare', mode: 'dark',
        colors: ['#161a26', '#1b202e', '#202636', '#252c3e', '#293044', '#323b52', '#3f4a66', '#293044', '#34426c', '#2c344a', '#44506e',
            '#d8deec', '#bec6d8', '#98a2ba', '#808aa4', '#8aaaf0', '#4668c8', '#5a7ee0', '#82c88c', '#e6be64', '#ec7a80', '#ba98e2'] },
    { id: 'darcula', label: 'Darcula', group: 'editor', mode: 'dark',
        colors: ['#2b2b2b', '#323436', '#3c3f41', '#45494a', '#35383a', '#4c5052', '#5c6163', '#484c4e', '#214283', '#46484a', '#5e6062',
            '#bbbbbb', '#a9b7c6', '#9da1a5', '#92969a', '#589df6', '#3669a8', '#4a88c7', '#7ca364', '#ffc66d', '#ff6b68', '#b294c4'] },
    { id: 'material', label: 'Sublime Material', group: 'editor', mode: 'dark',
        colors: ['#263238', '#212c32', '#29363d', '#2e3c44', '#29363d', '#37474f', '#455a64', '#32424a', '#345462', '#37474f', '#546e7a',
            '#eeffff', '#b0bec5', '#90a4ae', '#879da8', '#80cbc4', '#00897b', '#009688', '#c3e88d', '#ffcb6b', '#f07178', '#c792ea'] },
    { id: 'monokai', label: 'Monokai', group: 'editor', mode: 'dark',
        colors: ['#272822', '#2d2e27', '#34352c', '#3e3d32', '#31322a', '#49483b', '#5a5948', '#3a3b30', '#545234', '#46473a', '#626150',
            '#f8f8f2', '#d7d7cd', '#a6a696', '#96937d', '#66d9ef', '#1e829c', '#3ca0b9', '#a6e22e', '#e6db74', '#f92672', '#ae81ff'] },
    { id: 'mariana', label: 'Mariana', group: 'editor', mode: 'dark',
        colors: ['#2e3842', '#242d35', '#28323b', '#333e48', '#28323b', '#3e4a55', '#4e5b67', '#313c46', '#465666', '#3a4550', '#596673',
            '#d8dee9', '#cbcdcf', '#a6acb9', '#969fad', '#f9ae58', '#5080b4', '#6699cc', '#a3ce9e', '#fab763', '#ee6a6f', '#c594c5'] },
    { id: 'solarized-dark', label: 'Solarized Dark', group: 'editor', mode: 'dark',
        colors: ['#042029', '#072630', '#0a2933', '#0e323e', '#0a2933', '#123b48', '#1c4c5b', '#0c2f3a', '#144656', '#123b48', '#3c5a64',
            '#93a1a1', '#839496', '#758a8e', '#6c838a', '#268bd2', '#1e78b9', '#268bd2', '#859900', '#b58900', '#dc322f', '#6c71c4'] },
    { id: 'solarized-light', label: 'Solarized Light', group: 'editor', mode: 'light',
        colors: ['#fdf6e3', '#f7f0dc', '#eee8d5', '#fffbf0', '#f7f0dc', '#e8e1cb', '#dad3bb', '#eee8d5', '#cddee2', '#ddd6c0', '#93a1a1',
            '#073642', '#3e5a64', '#586e75', '#657b83', '#1e76b4', '#1c70ac', '#145f96', '#657800', '#966e00', '#c82624', '#585db0'] },
    { id: 'idea-classic-light', label: 'IntelliJ Light', group: 'editor', mode: 'light',
        colors: ['#ffffff', '#f7f7f7', '#f2f2f2', '#ffffff', '#f7f7f7', '#ebebeb', '#dfdfdf', '#edf5fc', '#a6d2ff', '#d1d1d1', '#b0b0b0',
            '#080808', '#404040', '#6e6e6e', '#808080', '#2470b3', '#4989cc', '#346dad', '#4a9249', '#a46704', '#c7222d', '#7444d4'] },
    { id: 'idea-light', label: 'IDEA Light', group: 'editor', mode: 'light',
        colors: ['#ffffff', '#fafbfc', '#f7f8fa', '#ffffff', '#f7f8fa', '#ebecf0', '#dfe1e5', '#edf3ff', '#d4e2ff', '#ebecf0', '#c9ccd6',
            '#080808', '#383a42', '#6c707e', '#787c8b', '#3574f0', '#3574f0', '#3369d6', '#208a3c', '#a46704', '#db3b4b', '#7444d4'] },
    { id: 'kiro-dark', label: 'Kiro Dark', group: 'editor', mode: 'dark',
        colors: ['#211d25', '#24202a', '#28242e', '#2d2834', '#28242e', '#352f3d', '#4a464f', '#302c36', '#3a3050', '#4a464f', '#6a6571',
            '#f2f1f4', '#d0cdd6', '#a9a5b1', '#938f9b', '#b080ff', '#7138cc', '#8e47ff', '#80ffb5', '#ffcf99', '#ff8080', '#8e47ff'] },
    { id: 'kiro-light', label: 'Kiro Light', group: 'editor', mode: 'light',
        colors: ['#f2f1f4', '#f6f5f8', '#eae8ed', '#ffffff', '#eae8ed', '#e0dee5', '#d1ced7', '#e8e6ec', '#e2dbef', '#c1bec6', '#938f9b',
            '#352f3d', '#544e5d', '#706a7a', '#7a7484', '#7138cc', '#7138cc', '#6432b3', '#367c53', '#a86210', '#993333', '#8e47ff'] },
] as const;

export type AppearanceTheme = typeof palettes[number]['id'] | 'tabby';
export const workbenchSurfaces = ':is(oneai-projects, oneai-status, oneai-overlay, .oneai-tooltip)';
const themeKey = 'tabby-oneai.appearance.theme.v1';
const fontKey = 'tabby-oneai.appearance.font.v1';
const fontSizeKey = 'tabby-oneai.appearance.font-size.v1';
const letterSpacingKey = 'tabby-oneai.appearance.letter-spacing.v1';
export const defaultInterfaceFontSize = 13;
export const interfaceFontSizeRange = { min: 11, max: 24 };
export const defaultMonoLetterSpacing = -0.9;
export const defaultInterfaceLetterSpacing = 0;
export const interfaceLetterSpacingRange = { min: -1.2, max: 1.2, step: 0.1 };
export const systemUiFontStack = '"Segoe UI Variable", "Segoe UI", "Noto Sans SC", "HarmonyOS Sans SC", "Sarasa UI SC", "MiSans", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif';
export const defaultInterfaceFontStack = systemUiFontStack;
export const defaultMonoFontStack = '"Cascadia Code", "Cascadia Mono", "JetBrainsMono Nerd Font", "JetBrains Mono", "Sarasa Mono SC", "Maple Mono NF CN", Consolas, "Courier New", monospace';
const wideMonoFontPattern = /(?:maple\s*mono|sarasa\s*(?:mono|term))/i;

export const paletteStyles = palettes.map(({ id, mode, colors }) => `
    app-root[data-oneai-theme="${id}"] ${workbenchSurfaces} {
        --oneai-scheme:${mode};
        --oneai-icon:${mode === 'dark' ? 'invert(1)' : 'none'};
        ${colorRoles.map((role, index) => `--palette-${role}:${colors[index]};`).join(' ')}
    }`).join('\n');

function storedValue(key: string): string {
    try { return localStorage.getItem(key) ?? ''; }
    catch { return ''; }
}

function customFontSize(size: number): number {
    const { min, max } = interfaceFontSizeRange;
    return Math.max(min, Math.min(max, Math.round(size)));
}

function customLetterSpacing(spacing: number): number {
    const { min, max } = interfaceLetterSpacingRange;
    return Math.round(Math.max(min, Math.min(max, spacing)) * 10) / 10;
}

@Injectable()
export class WorkbenchAppearance {
    private readonly changed = new BehaviorSubject<void>(undefined);
    readonly changed$ = merge(this.changed, this.config.changed$);
    theme: AppearanceTheme = this.initialTheme();
    fontFamily = storedValue(fontKey);
    fontSize = this.initialFontSize();
    private customSpacing = this.initialLetterSpacing();

    constructor(@Inject(ConfigService) private readonly config: HostConfig) {}

    get isAutoLetterSpacing(): boolean {
        return this.customSpacing === undefined;
    }

    isWideMonoActive(): boolean {
        return Boolean(this.fontFamily) && wideMonoFontPattern.test(this.fontFamily);
    }

    get autoLetterSpacing(): number {
        return this.isWideMonoActive() ? defaultMonoLetterSpacing : defaultInterfaceLetterSpacing;
    }

    get letterSpacing(): number {
        return this.customSpacing ?? this.autoLetterSpacing;
    }

    get wordSpacing(): number {
        const spacing = this.letterSpacing;
        if (!this.isWideMonoActive() || spacing >= 0) return 0;
        return Math.max(-3.6, Math.round(spacing * 2.6 * 10) / 10);
    }

    setFontSize(size: number): void {
        if (!Number.isFinite(size)) return;
        const clamped = customFontSize(size);
        localStorage.setItem(fontSizeKey, String(clamped));
        this.fontSize = clamped;
        this.changed.next();
    }

    resetFontSize(): void {
        localStorage.setItem(fontSizeKey, String(defaultInterfaceFontSize));
        this.fontSize = defaultInterfaceFontSize;
        this.changed.next();
    }

    setLetterSpacing(spacing: number): void {
        if (!Number.isFinite(spacing)) return;
        const clamped = customLetterSpacing(spacing);
        localStorage.setItem(letterSpacingKey, String(clamped));
        this.customSpacing = clamped;
        this.changed.next();
    }

    resetLetterSpacing(): void {
        localStorage.removeItem(letterSpacingKey);
        this.customSpacing = undefined;
        this.changed.next();
    }

    setTheme(theme: AppearanceTheme): void {
        localStorage.setItem(themeKey, theme);
        this.theme = theme;
        this.changed.next();
    }

    setFontFamily(fontFamily: string): void {
        localStorage.setItem(fontKey, fontFamily);
        this.fontFamily = fontFamily;
        this.changed.next();
    }

    private initialTheme(): AppearanceTheme {
        const id = storedValue(themeKey);
        return palettes.find(palette => palette.id === id)?.id ?? 'tabby';
    }

    private initialFontSize(): number {
        const raw = storedValue(fontSizeKey);
        if (!raw) return defaultInterfaceFontSize;
        const numeric = Number(raw);
        if (Number.isFinite(numeric) && numeric > 0) return customFontSize(numeric);
        try {
            const legacy = JSON.parse(raw) as { followTabby?: boolean; custom?: number } | null;
            if (legacy && legacy.followTabby === false && typeof legacy.custom === 'number' && Number.isFinite(legacy.custom)) {
                return customFontSize(legacy.custom);
            }
        } catch { /* Fall back to the independent default font size. */ }
        return defaultInterfaceFontSize;
    }

    private initialLetterSpacing(): number | undefined {
        const raw = storedValue(letterSpacingKey);
        if (!raw) return undefined;
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? customLetterSpacing(numeric) : undefined;
    }
}
