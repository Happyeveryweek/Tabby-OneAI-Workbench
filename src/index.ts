import { CommonModule } from '@angular/common';
import { ApplicationRef, createComponent, EnvironmentInjector, Inject, Injectable, NgModule, NgZone, OnDestroy } from '@angular/core';
import type { ComponentRef, Type } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ConfigProvider, HotkeyProvider, HotkeysService, ToolbarButtonProvider } from './host';
import { workbenchHotkeys, WorkbenchHotkeyProvider } from './hotkeys';
import { ProjectsComponent, StatusComponent, WorkbenchNavigation, WorkbenchTab } from './components';
import { WorkspaceService } from './workspace';
import { CodexService } from './codex';
import { CliDirectoriesPanel } from './codex-panel';
import { WorkbenchOverlay } from './workbench-overlay';
import { SessionPanelComponent } from './session-panel';
import { defaultInterfaceFontSize, defaultInterfaceFontStack, defaultInterfaceLetterSpacing, paletteStyles, WorkbenchAppearance, workbenchSurfaces } from './appearance';
import { WorkbenchI18n } from './i18n';

const workbenchIconPath = 'M1 2h14v12H1zm1.5 1.5v9h11v-9zM4 5l3 3-3 3-1-1 2-2-2-2zm4 4.5h4V11H8z';

@Injectable()
class WorkbenchLayout implements OnDestroy {
    private sidebar?: ComponentRef<ProjectsComponent>;
    private status?: ComponentRef<StatusComponent>;
    private overlay?: ComponentRef<WorkbenchOverlay>;
    private css?: HTMLStyleElement;
    private hostColors?: HTMLStyleElement;
    private observer?: MutationObserver;
    private headerObserver?: ResizeObserver;
    private tooltip?: HTMLDivElement;
    private cleanupTooltips?: () => void;
    private alignment?: { window: Element; tabBar?: Element | null; status?: HTMLElement };
    private colorSampleCtx?: CanvasRenderingContext2D | null;
    private lastThemeBg?: string;
    private lastHostColorCss = '';
    private lastHeaderHeight = '';
    private lastHistoryTop = '';
    private ready: Subscription;
    private shortcuts: Subscription;
    private theme?: Subscription;

    constructor(
        @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
        @Inject(ApplicationRef) private readonly appRef: ApplicationRef,
        @Inject(EnvironmentInjector) private readonly injector: EnvironmentInjector,
        @Inject(WorkbenchNavigation) navigation: WorkbenchNavigation,
        @Inject(WorkbenchAppearance) private readonly appearance: WorkbenchAppearance,
        @Inject(HotkeysService) hotkeys: { readonly hotkey$: import('rxjs').Observable<string> },
        @Inject(NgZone) private readonly zone: NgZone,
    ) {
        this.ready = workspace.app.ready$.subscribe(() => this.observeLayout());
        this.shortcuts = hotkeys.hotkey$.subscribe(id => {
            const binding = workbenchHotkeys.find(item => item.id === id);
            if (!binding) return;
            this.zone.run(() => {
                if (binding.action === 'sidebar') workspace.collapsed = !workspace.collapsed;
                else navigation.open(binding.action);
            });
        });
    }

    private observeLayout(): void {
        const root = document.querySelector('app-root');
        if (!root || this.observer) return;
        try { this.overlay = this.attach(WorkbenchOverlay, root, null); }
        catch (error) { console.error('[tabby-oneai] overlay mount failed:', error); }
        this.css = document.createElement('style');
        this.css.textContent = `app-root .window:has(>oneai-projects) > .content.main { width:auto; min-width:0 }
            app-root:has(> .window > oneai-projects) .tab-bar button:has(path[d="${workbenchIconPath}"]) { display:none!important; }
            app-root ${workbenchSurfaces} {
                --oneai-opaque-base:light-dark(#f4f7fb,#151d28);
                --oneai-size:var(--oneai-interface-font-size,${defaultInterfaceFontSize}px);
                --oneai-size-small:calc(var(--oneai-size) * 10 / ${defaultInterfaceFontSize});
                --oneai-size-caption:calc(var(--oneai-size) * 11 / ${defaultInterfaceFontSize});
                --oneai-size-meta:calc(var(--oneai-size) * 12 / ${defaultInterfaceFontSize});
                --oneai-size-body:calc(var(--oneai-size) * 13 / ${defaultInterfaceFontSize});
                --oneai-size-heading:calc(var(--oneai-size) * 16 / ${defaultInterfaceFontSize});
                color-scheme:var(--oneai-scheme); font-family:var(--oneai-interface-font,${defaultInterfaceFontStack}); font-size:var(--oneai-size);
                letter-spacing:var(--oneai-interface-letter-spacing,${defaultInterfaceLetterSpacing}px);
            }
            app-root ${workbenchSurfaces} :is(code, .metrics, .size-pill, .version, .branch, .runtime-badge, .origin-runtime, .recent-date, .nav-badge, time) { letter-spacing:0px; }
            app-root ${workbenchSurfaces} :is(img[alt="Codex"],img.codex-mark) { filter:var(--oneai-icon) }
            app-root tab-header img[alt="Codex"] { filter:var(--oneai-icon) }
            app-root tab-header profile-icon:not(:has(img.oneai-cli)) { display:none!important; }
            app-root tab-header profile-icon:has(img.oneai-cli) { order:-1; display:inline-flex; align-items:center; align-self:center; flex:none; font-size:inherit; line-height:inherit; margin:1px 4px 0 0; }
            app-root tab-header profile-icon .icon:has(img.oneai-cli) { display:inline-flex; align-items:center; width:1.08em; height:1.08em; vertical-align:middle; line-height:inherit; margin:0; }
            app-root tab-header img.oneai-cli { display:inline-block; width:1.08em; height:1.08em; vertical-align:middle; }
            @keyframes oneai-tab-sweep { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
            @keyframes oneai-tab-pulse-green {
                0%, 100% { box-shadow:0 0 6px rgba(32, 183, 130, 0.45); }
                50% { box-shadow:0 -1px 12px rgba(110, 231, 183, 0.85); }
            }
            @keyframes oneai-tab-pulse-amber {
                0%, 100% { opacity:.75; box-shadow:0 0 4px rgba(207, 146, 12, 0.35); }
                50% { opacity:1; box-shadow:0 -1px 10px rgba(251, 191, 36, 0.78); }
            }
            app-root tab-header:has(img.oneai-cli):has(> .colorbar) > .current-tab-indicator { display:none!important; }
            app-root tab-header:has(img.oneai-cli) > .colorbar:is([style*="32, 183, 130" i], [style*="#20b782" i]) {
                background:linear-gradient(90deg,#12805a,#20b782,#6ee7b7,#d1fae5,#6ee7b7,#20b782,#12805a)!important;
                background-size:200% 100%; animation:oneai-tab-sweep 1.35s linear infinite, oneai-tab-pulse-green 1.35s ease-in-out infinite;
            }
            app-root tab-header:has(img.oneai-cli) > .colorbar:is([style*="207, 146, 12" i], [style*="#cf920c" i]) {
                background:linear-gradient(90deg,#b47908,#cf920c,#fbbf24,#cf920c,#b47908)!important;
                background-size:200% 100%; animation:oneai-tab-sweep 2.2s linear infinite, oneai-tab-pulse-amber 1.6s ease-in-out infinite;
            }
            app-root .oneai-tooltip { position:fixed; inset:auto; margin:0; padding:6px 10px; max-width:min(360px,calc(100vw - 24px));
                border-radius:9px; border:1px solid var(--palette-line-strong,var(--palette-line,color-mix(in srgb,currentColor 20%,transparent)));
                color:var(--palette-fg,var(--theme-fg,#e5edf5));
                background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
                background-image:linear-gradient(var(--palette-elevated,var(--palette-surface,var(--theme-bg-more,#18222e))),var(--palette-elevated,var(--palette-surface,var(--theme-bg-more,#18222e))));
                box-shadow:0 12px 30px #0007; font-size:var(--oneai-size-meta); line-height:1.4; pointer-events:none;
                overflow-wrap:anywhere; white-space:pre-wrap; z-index:2147483647; }
            ${paletteStyles}`;
        this.hostColors = document.createElement('style');
        document.head.append(this.hostColors, this.css);
        this.theme = this.appearance.changed$.subscribe(this.applyTheme);
        this.zone.runOutsideAngular(() => {
            this.setupTooltips(root);
            this.observer = new MutationObserver(records => {
                if (records.some(record => record.target === document.documentElement)) this.updateHostColors();
                const sidebarParent = this.sidebar?.location.nativeElement.parentElement;
                if (records.some(({ target }) => target === sidebarParent || (target instanceof Element && target.matches('app-root, .window, .content.main')))) {
                    this.mount(root);
                }
            });
            this.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
            this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        });
        this.updateHostColors();
        try { this.mount(root); }
        catch (error) { console.error('[tabby-oneai] initial mount failed:', error); }
    }

    private readonly applyTheme = (): void => {
        const root = document.querySelector<HTMLElement>('app-root');
        if (!root) return;
        const theme = this.appearance.theme;
        if (theme === 'tabby') root.removeAttribute('data-oneai-theme');
        else root.setAttribute('data-oneai-theme', theme);
        const font = this.appearance.fontFamily.replace(/[\x00-\x1f\x7f]/g, '').replace(/["\\]/g, '\\$&');
        if (font) root.style.setProperty('--oneai-interface-font', `"${font}", ${defaultInterfaceFontStack}`);
        else root.style.removeProperty('--oneai-interface-font');
        root.style.setProperty('--oneai-interface-font-size', `${this.appearance.fontSize}px`);
        root.style.setProperty('--oneai-interface-letter-spacing', `${this.appearance.letterSpacing}px`);
    };

    private updateHostColors(): void {
        const css = getComputedStyle(document.documentElement);
        const bg = css.getPropertyValue('--theme-bg').trim() || '#18212b';
        if (bg === this.lastThemeBg && this.lastHostColorCss) return;
        this.lastThemeBg = bg;
        const sample = (this.colorSampleCtx ??= document.createElement('canvas').getContext('2d'));
        let scheme = 'dark';
        if (sample) {
            sample.fillStyle = bg;
            sample.fillRect(0, 0, 1, 1);
            const [red, green, blue] = sample.getImageData(0, 0, 1, 1).data;
            if (0.2126 * red + 0.7152 * green + 0.0722 * blue > 140) scheme = 'light';
        }
        const cssText = `app-root :is(${workbenchSurfaces}, tab-header) {
            --oneai-scheme:${scheme}; --oneai-icon:${scheme === 'dark' ? 'invert(1)' : 'none'};
        }`;
        if (cssText !== this.lastHostColorCss) {
            this.lastHostColorCss = cssText;
            if (this.hostColors) this.hostColors.textContent = cssText;
        }
    }

    private mount(root: Element): void {
        const window = root.querySelector(':scope > .window');
        const main = window?.querySelector(':scope > .content.main');
        const detachSidebar = Boolean(this.sidebar && this.sidebar.location.nativeElement.parentElement !== window);
        const attachSidebar = Boolean(window && main && (!this.sidebar || detachSidebar));

        const tabsOnTop = main?.matches('.tabs-on-top:not(.tabs-on-left):not(.tabs-on-right)');
        const tabBar = main?.querySelector(':scope > .tab-bar');
        const detachStatus = Boolean(this.status && (!tabsOnTop || !tabBar || this.status.location.nativeElement.parentElement !== main));
        const attachStatus = Boolean(main && tabsOnTop && tabBar && (!this.status || detachStatus));

        if (detachSidebar || attachSidebar || detachStatus || attachStatus) {
            this.zone.run(() => {
                try {
                    if (detachSidebar && this.sidebar) {
                        this.detach(this.sidebar);
                        this.sidebar = undefined;
                    }
                    if (attachSidebar && window) {
                        this.sidebar = this.attach(ProjectsComponent, window, window.firstChild);
                    }
                    if (detachStatus && this.status) {
                        this.detach(this.status);
                        this.status = undefined;
                    }
                    if (attachStatus && main && tabBar) {
                        this.status = this.attach(StatusComponent, main, tabBar.nextSibling);
                    }
                } catch (error) {
                    console.error('[tabby-oneai] layout mount failed:', error);
                }
            });
        }
        const status = this.status?.location.nativeElement as HTMLElement | undefined;
        if (this.alignment?.window !== window || this.alignment?.tabBar !== tabBar || this.alignment?.status !== status) {
            this.headerObserver?.disconnect();
            this.alignment = window ? { window, tabBar, status } : undefined;
            if (window instanceof HTMLElement && tabBar && tabsOnTop) {
                const align = () => {
                    const bottom = Math.round((status ?? tabBar).getBoundingClientRect().bottom);
                    const headerHeight = `${Math.max(0, Math.round(bottom - window.getBoundingClientRect().top))}px`;
                    const historyTop = `${bottom}px`;
                    if (headerHeight !== this.lastHeaderHeight) {
                        this.lastHeaderHeight = headerHeight;
                        window.style.setProperty('--oneai-header-height', headerHeight);
                    }
                    if (historyTop !== this.lastHistoryTop) {
                        this.lastHistoryTop = historyTop;
                        (root as HTMLElement).style.setProperty('--oneai-history-top', historyTop);
                    }
                };
                this.zone.runOutsideAngular(() => {
                    this.headerObserver = new ResizeObserver(align);
                    this.headerObserver.observe(tabBar);
                    if (status) this.headerObserver.observe(status);
                });
                align();
            } else {
                if (this.lastHeaderHeight && window instanceof HTMLElement) window.style.removeProperty('--oneai-header-height');
                if (this.lastHistoryTop) (root as HTMLElement).style.removeProperty('--oneai-history-top');
                this.lastHeaderHeight = '';
                this.lastHistoryTop = '';
            }
        }
    }

    private attach<T>(component: Type<T>, parent: Node, before: Node | null): ComponentRef<T> {
        const ref = createComponent(component, { environmentInjector: this.injector });
        try {
            parent.insertBefore(ref.location.nativeElement, before);
            this.appRef.attachView(ref.hostView);
            ref.changeDetectorRef.detectChanges();
            return ref;
        } catch (error) {
            this.detach(ref);
            throw error;
        }
    }

    private detach(ref: ComponentRef<unknown>): void {
        try { this.appRef.detachView(ref.hostView); } catch {}
        try { ref.location.nativeElement.remove(); } catch {}
        try { ref.destroy(); } catch {}
    }

    ngOnDestroy(): void {
        this.ready.unsubscribe();
        this.shortcuts.unsubscribe();
        this.theme?.unsubscribe();
        const root = document.querySelector<HTMLElement>('app-root');
        root?.removeAttribute('data-oneai-theme');
        root?.style.removeProperty('--oneai-interface-font');
        root?.style.removeProperty('--oneai-interface-font-size');
        root?.style.removeProperty('--oneai-interface-letter-spacing');
        root?.style.removeProperty('--oneai-history-top');
        this.observer?.disconnect();
        this.observer = undefined;
        this.headerObserver?.disconnect();
        this.headerObserver = undefined;
        this.cleanupTooltips?.();
        this.cleanupTooltips = undefined;
        if (this.sidebar) this.detach(this.sidebar);
        if (this.status) this.detach(this.status);
        if (this.overlay) this.detach(this.overlay);
        this.css?.remove();
        this.hostColors?.remove();
        this.colorSampleCtx = undefined;
    }

    private setupTooltips(root: Element): void {
        const tip = document.createElement('div');
        tip.className = 'oneai-tooltip';
        tip.setAttribute('popover', 'manual');
        tip.setAttribute('aria-hidden', 'true');
        root.appendChild(tip);
        this.tooltip = tip;

        const surfaceSelector = 'oneai-projects, oneai-status, oneai-overlay';
        let activeTarget: HTMLElement | undefined;
        let showTimer: ReturnType<typeof setTimeout> | undefined;

        const hide = () => {
            if (showTimer) { clearTimeout(showTimer); showTimer = undefined; }
            activeTarget = undefined;
            try { if (tip.matches(':popover-open')) tip.hidePopover(); } catch {}
        };

        const syncTipText = (el: HTMLElement): string => {
            if (el.hasAttribute('title')) {
                const raw = el.getAttribute('title') ?? '';
                el.setAttribute('data-oneai-tip', raw);
                el.removeAttribute('title');
            }
            return (el.getAttribute('data-oneai-tip') ?? '').trim();
        };

        const suppressAncestorTitles = (start: Element | null) => {
            let cur: Element | null = start;
            while (cur && cur.closest(surfaceSelector)) {
                if (cur instanceof HTMLElement && cur.hasAttribute('title')) syncTipText(cur);
                cur = cur.parentElement;
            }
        };

        const placeTip = (target: HTMLElement) => {
            const rect = target.getBoundingClientRect();
            const width = tip.offsetWidth;
            const height = tip.offsetHeight;
            const left = Math.max(8, Math.min(rect.left + Math.max(0, (rect.width - width) / 2), window.innerWidth - width - 8));
            const below = rect.bottom + 8;
            const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 8);
            tip.style.left = `${Math.round(left)}px`;
            tip.style.top = `${Math.round(top)}px`;
        };

        const onMouseOver = (event: MouseEvent) => {
            const raw = event.target instanceof Element ? event.target : null;
            if (!raw || !raw.closest(surfaceSelector)) {
                if (activeTarget) hide();
                return;
            }
            suppressAncestorTitles(raw);
            const target = raw.closest<HTMLElement>('[title], [data-oneai-tip]');
            if (!target || !target.closest(surfaceSelector)) {
                if (activeTarget) hide();
                return;
            }
            const text = syncTipText(target);
            if (!text) {
                if (activeTarget) hide();
                return;
            }
            if (target === activeTarget && tip.matches(':popover-open')) {
                if (tip.textContent !== text) {
                    tip.textContent = text;
                    placeTip(target);
                }
                return;
            }
            hide();
            activeTarget = target;
            showTimer = setTimeout(() => {
                showTimer = undefined;
                if (!activeTarget || !activeTarget.isConnected || document.hidden) return;
                const latest = syncTipText(activeTarget);
                if (!latest) return;
                tip.textContent = latest;
                try { if (!tip.matches(':popover-open')) tip.showPopover(); } catch { return; }
                placeTip(activeTarget);
            }, 300);
        };

        const onMouseOut = (event: MouseEvent) => {
            if (!activeTarget) return;
            const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
            if (!next || !activeTarget.contains(next)) hide();
        };

        root.addEventListener('mouseover', onMouseOver as EventListener, true);
        root.addEventListener('mouseout', onMouseOut as EventListener, true);
        window.addEventListener('pointerdown', hide, true);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('blur', hide);
        window.addEventListener('keydown', hide, true);

        this.cleanupTooltips = () => {
            hide();
            root.removeEventListener('mouseover', onMouseOver as EventListener, true);
            root.removeEventListener('mouseout', onMouseOut as EventListener, true);
            window.removeEventListener('pointerdown', hide, true);
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('blur', hide);
            window.removeEventListener('keydown', hide, true);
            tip.remove();
            this.tooltip = undefined;
        };
    }
}

@Injectable()
class WorkbenchButton extends ToolbarButtonProvider {
    constructor(
        @Inject(WorkbenchNavigation) private readonly navigation: WorkbenchNavigation,
        @Inject(WorkbenchI18n) private readonly i18n: WorkbenchI18n,
    ) { super(); }

    provide() {
        return [{
            title: this.i18n.text('AI 工作台', 'AI Workbench'),
            weight: 10,
            icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${workbenchIconPath}" fill-rule="evenodd"/></svg>`,
            click: () => {
                if (!document.querySelector('app-root > .window > oneai-projects')) this.navigation.open('tasks');
            },
        }];
    }
}

@Injectable()
class WorkbenchTabDefaults extends ConfigProvider {
    defaults = {
        terminal: { showTabProfileIcon: true },
        hotkeys: Object.fromEntries(workbenchHotkeys.map(({ id, defaultKeys }) => [id, [...defaultKeys]])),
    };
}

@NgModule({
    imports: [CommonModule],
    declarations: [ProjectsComponent, StatusComponent, WorkbenchTab, CliDirectoriesPanel, WorkbenchOverlay, SessionPanelComponent],
    providers: [
        CodexService, WorkspaceService, WorkbenchNavigation, WorkbenchAppearance, WorkbenchI18n, WorkbenchLayout,
        { provide: ToolbarButtonProvider, useClass: WorkbenchButton, multi: true },
        { provide: ConfigProvider, useClass: WorkbenchTabDefaults, multi: true },
        { provide: HotkeyProvider, useClass: WorkbenchHotkeyProvider, multi: true },
    ],
})
export default class TabbyOneAiModule {
    constructor(@Inject(WorkbenchLayout) _layout: WorkbenchLayout) {}
}
