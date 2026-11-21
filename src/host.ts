import type { Injector, Type } from '@angular/core';
import type { Observable } from 'rxjs';

export interface LocalProfile {
    id: string;
    type: 'local';
    name: string;
    icon?: string;
    color?: string;
    disableDynamicTitle: boolean;
    behaviorOnSessionEnd: 'keep';
    options: { command: string; args: string[]; cwd?: string; env?: Record<string, string> };
}

export interface Tab {
    readonly destroyed$: Observable<void>;
    icon: string | null;
    color: string | null;
    setTitle(title: string): void;
    readonly profile?: LocalProfile;
    readonly session?: Session | null;
    readonly sessionChanged$?: Observable<Session | null>;
    readonly output$?: Observable<string>;
    readonly frontend?: { readonly title$: Observable<string>; readonly xterm?: TerminalScreen };
    readonly frontendReady$?: Observable<void>;
    readonly initialized$?: Observable<void>;
    getAllTabs?(): Tab[];
    getFocusedTab?(): Tab | null;
    focus?(tab: Tab): void;
    canClose?(): Promise<boolean>;
    readonly focusChanged$?: Observable<Tab>;
}

export interface TerminalScreen {
    readonly rows: number;
    readonly buffer: {
        readonly active: {
            readonly type?: 'normal' | 'alternate';
            readonly baseY: number;
            readonly cursorY: number;
            getLine(index: number): { translateToString(trimRight: boolean): string } | undefined;
        };
    };
    onWriteParsed(listener: () => void): { dispose(): void };
}

interface Session {
    readonly open: boolean;
    readonly closed$: Observable<void>;
    readonly destroyed$: Observable<void>;
}

interface App {
    readonly tabs: Tab[];
    readonly activeTab: Tab | null;
    readonly ready$: Observable<void>;
    readonly tabsChanged$: Observable<void>;
    readonly activeTabChange$: Observable<Tab | null>;
    getParentTab(tab: Tab): Tab | null;
    selectTab(tab: Tab | null): void;
    openNewTabRaw<T extends Tab>(params: { type: Type<T> }): T;
    closeWindow?(): Promise<void>;
}

interface Profiles {
    openNewTabForProfile(profile: LocalProfile): Promise<Tab | null>;
}

interface Platform {
    pickDirectory(): Promise<string | null>;
    setClipboard(content: { text: string }): void;
    listFonts(): Promise<string[]>;
    openPath?(path: string): void;
}

export interface HostConfig {
    readonly changed$: Observable<void>;
    store: {
        hotkeys: Record<string, unknown>;
        terminal: { fontFamily: string; fontSize: number; linePadding: number; cursor: string; cursorBlink: boolean; showTabProfileIcon: boolean };
    };
    save(): Promise<void>;
}

// Tabby v1.0.238 resolves these tokens from its installed runtime.
const host = require('tabby-core') as {
    AppService: Type<App>;
    ProfilesService: Type<Profiles>;
    PlatformService: Type<Platform>;
    BaseTabComponent: new (injector: Injector) => Tab;
    ConfigProvider: new () => object;
    ConfigService: Type<HostConfig>;
    HotkeyProvider: new () => object;
    HotkeysService: Type<{ readonly hotkey$: Observable<string>; disable?(): void; enable?(): void }>;
    ToolbarButtonProvider: new () => object;
};

export const { AppService, ProfilesService, PlatformService, BaseTabComponent, ConfigProvider, ConfigService, HotkeyProvider, HotkeysService, ToolbarButtonProvider } = host;
export type { App, Profiles, Platform };
