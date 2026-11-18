import { CommonModule } from '@angular/common';
import { ApplicationRef, createComponent, EnvironmentInjector, Inject, Injectable, NgModule, OnDestroy } from '@angular/core';
import type { ComponentRef, Type } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ToolbarButtonProvider } from './host';
import type { Tab } from './host';
import { ProjectsComponent, StatusComponent, WorkbenchTab } from './components';
import { WorkspaceService } from './workspace';

@Injectable()
class WorkbenchLayout implements OnDestroy {
    private sidebar?: ComponentRef<ProjectsComponent>;
    private status?: ComponentRef<StatusComponent>;
    private css?: HTMLStyleElement;
    private observer?: MutationObserver;
    private ready: Subscription;
    private tab?: Tab;

    constructor(
        @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
        @Inject(ApplicationRef) private readonly appRef: ApplicationRef,
        @Inject(EnvironmentInjector) private readonly injector: EnvironmentInjector,
    ) {
        this.ready = workspace.app.ready$.subscribe(() => this.observeLayout());
    }

    openWorkbench(): void {
        const app = this.workspace.app;
        if (this.tab && app.tabs.includes(this.tab)) {
            app.selectTab(this.tab);
        } else {
            this.tab = app.openNewTabRaw({ type: WorkbenchTab });
        }
    }

    private observeLayout(): void {
        const root = document.querySelector('app-root');
        if (!root) return;
        this.css = document.createElement('style');
        document.head.append(this.css);
        this.observer = new MutationObserver(records => {
            if (records.some(record => record.target === document.documentElement)) this.updateStyles();
            const sidebarParent = this.sidebar?.location.nativeElement.parentElement;
            if (records.some(({ target }) => target === sidebarParent || (target instanceof Element && target.matches('app-root, .window, .content.main')))) {
                this.mount(root);
            }
        });
        this.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
        this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        this.updateStyles();
        this.mount(root);
    }

    private updateStyles(): void {
        const css = getComputedStyle(document.documentElement);
        const sample = document.createElement('canvas').getContext('2d');
        let scheme = 'dark';
        if (sample) {
            sample.fillStyle = css.getPropertyValue('--theme-bg') || '#18212b';
            sample.fillRect(0, 0, 1, 1);
            const [red, green, blue] = sample.getImageData(0, 0, 1, 1).data;
            if (0.2126 * red + 0.7152 * green + 0.0722 * blue > 140) scheme = 'light';
        }
        this.css!.textContent = `app-root .window:has(>oneai-projects) > .content.main { width:auto; min-width:0 }
            app-root :is(oneai-projects, oneai-status) { color-scheme: ${scheme} }`;
    }

    private mount(root: Element): void {
        const window = root.querySelector(':scope > .window');
        const main = window?.querySelector(':scope > .content.main');
        if (this.sidebar && this.sidebar.location.nativeElement.parentElement !== window) {
            this.detach(this.sidebar);
            this.sidebar = undefined;
        }
        if (window && main && !this.sidebar) {
            this.sidebar = this.attach(ProjectsComponent, window, window.firstChild);
        }

        const tabsOnTop = main?.matches('.tabs-on-top:not(.tabs-on-left):not(.tabs-on-right)');
        const tabBar = main?.querySelector(':scope > .tab-bar');
        if (this.status && (!tabsOnTop || !tabBar || this.status.location.nativeElement.parentElement !== main)) {
            this.detach(this.status);
            this.status = undefined;
        }
        if (main && tabsOnTop && tabBar && !this.status) {
            this.status = this.attach(StatusComponent, main, tabBar.nextSibling);
        }
    }

    private attach<T>(component: Type<T>, parent: Node, before: Node | null): ComponentRef<T> {
        const ref = createComponent(component, { environmentInjector: this.injector });
        parent.insertBefore(ref.location.nativeElement, before);
        this.appRef.attachView(ref.hostView);
        ref.changeDetectorRef.detectChanges();
        return ref;
    }

    private detach(ref: ComponentRef<unknown>): void {
        this.appRef.detachView(ref.hostView);
        ref.location.nativeElement.remove();
        ref.destroy();
    }

    ngOnDestroy(): void {
        this.ready.unsubscribe();
        this.observer?.disconnect();
        if (this.sidebar) this.detach(this.sidebar);
        if (this.status) this.detach(this.status);
        this.css?.remove();
    }
}

@Injectable()
class WorkbenchButton extends ToolbarButtonProvider {
    constructor(@Inject(WorkbenchLayout) private readonly layout: WorkbenchLayout) { super(); }

    provide() {
        return [{
            title: 'AI 工作台',
            weight: 10,
            icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 2h14v12H1zm1.5 1.5v9h11v-9zM4 5l3 3-3 3-1-1 2-2-2-2zm4 4.5h4V11H8z" fill-rule="evenodd"/></svg>',
            click: () => this.layout.openWorkbench(),
        }];
    }
}

@NgModule({
    imports: [CommonModule],
    declarations: [ProjectsComponent, StatusComponent, WorkbenchTab],
    providers: [WorkspaceService, WorkbenchLayout, { provide: ToolbarButtonProvider, useClass: WorkbenchButton, multi: true }],
})
export default class TabbyOneAiModule {
    constructor(@Inject(WorkbenchLayout) _layout: WorkbenchLayout) {}
}
