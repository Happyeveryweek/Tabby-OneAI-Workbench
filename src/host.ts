import type { Injector, Type } from '@angular/core';
import type { Observable } from 'rxjs';

export interface LocalProfile {
    id: string;
    type: 'local';
    name: string;
    disableDynamicTitle: boolean;
    behaviorOnSessionEnd: 'keep';
    options: { command: string; args: string[]; cwd?: string };
}

export interface Tab {
    readonly destroyed$: Observable<void>;
    setTitle(title: string): void;
    readonly profile?: LocalProfile;
    readonly session?: Session | null;
    readonly sessionChanged$?: Observable<Session | null>;
    readonly output$?: Observable<string>;
    getAllTabs?(): Tab[];
    getFocusedTab?(): Tab | null;
    focus?(tab: Tab): void;
    readonly focusChanged$?: Observable<Tab>;
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
}

interface Profiles {
    openNewTabForProfile(profile: LocalProfile): Promise<Tab | null>;
}

interface Platform {
    pickDirectory(): Promise<string | null>;
}

// Tabby v1.0.238 resolves these tokens from its installed runtime.
const host = require('tabby-core') as {
    AppService: Type<App>;
    ProfilesService: Type<Profiles>;
    PlatformService: Type<Platform>;
    BaseTabComponent: new (injector: Injector) => Tab;
    ToolbarButtonProvider: new () => object;
};

export const { AppService, ProfilesService, PlatformService, BaseTabComponent, ToolbarButtonProvider } = host;
export type { App, Profiles, Platform };
