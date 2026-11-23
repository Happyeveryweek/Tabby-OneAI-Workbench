import { ChangeDetectorRef, Component, ElementRef, HostListener, Inject, Injectable, Injector, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subject } from 'rxjs';
import type { Subscription } from 'rxjs';
import { BaseTabComponent } from './host';
import type { Tab } from './host';
import { distributions, environment, resolveProjectLocation, terminalCommand } from './commands';
import type { Project } from './commands';
import { cliBrand, supportedCli, terminalIconSource } from './cli-icons';
import { WorkbenchI18n } from './i18n';
import { statusDisplay, taskStatusLabel, WorkspaceService } from './workspace';
import type { Task } from './workspace';
import { defaultAccount } from './codex';
import type { HistoryEntry } from './codex';
import type { Quota, QuotaWindow } from './codex-data';

const pluginVersion = (require('../package.json') as { version: string }).version;

@Injectable()
export class WorkbenchNavigation {
    readonly overlay$ = new Subject<{ page: 'history' | 'usage' | 'settings' | 'search'; session?: Task | HistoryEntry; project?: Project; cli?: string }>();
    private tab?: Tab;

    constructor(@Inject(WorkspaceService) private readonly workspace: WorkspaceService) {}

    open(page: 'tasks' | 'history' | 'usage' | 'settings' | 'search', session?: Task | HistoryEntry, project?: Project, cli?: string): void {
        if (page !== 'tasks') {
            this.overlay$.next({ page, session, project, cli });
            return;
        }
        const app = this.workspace.app;
        if (this.tab && app.tabs.includes(this.tab)) app.selectTab(this.tab);
        else this.tab = app.openNewTabRaw({ type: WorkbenchTab });
    }
}

const theme = `
    :host { color:var(--palette-fg,var(--theme-fg,#e5edf5)); --oneai-surface:var(--palette-surface,var(--theme-bg-more,#18212b));
        --oneai-line:var(--palette-line,color-mix(in srgb,currentColor 16%,transparent));
        --oneai-tree-line:color-mix(in srgb,var(--palette-fg-subtle,currentColor) 36%,transparent);
        --oneai-active:var(--palette-selected,color-mix(in srgb,#29b5e5 17%,transparent));
        --oneai-accent:var(--palette-accent,light-dark(#066e91,#38bdf8)); --oneai-green:var(--palette-success,light-dark(#146c43,#34d399));
        --oneai-amber:var(--palette-warning,light-dark(#845500,#fbbf24)); --oneai-red:var(--palette-danger,light-dark(#a52237,#fb7185));
        --oneai-purple:var(--palette-violet,light-dark(#674197,#c084fc)); }
    button { font:inherit; color:inherit; background:transparent; border:0; border-radius:6px; min-height:28px; cursor:pointer }
    button:hover:not(:disabled) { background:var(--palette-hover,color-mix(in srgb,currentColor 8%,transparent)) }
    button:focus-visible { outline:2px solid var(--oneai-accent); outline-offset:-2px }
    .quiet { opacity:.73 }
    .ellipsis { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0 }

    /* 全插件唯一统一状态视觉规范：Running=绿, Ready/Online=青蓝, Waiting/Starting=琥珀, Failed=红, Exited=空心灰环 */
    .running,.working { color:var(--oneai-green) }
    .starting,.unread,.waiting { color:var(--oneai-amber) }
    .ready,.online { color:var(--oneai-accent) }
    .stopped { color:var(--palette-fg-faint,color-mix(in srgb,currentColor 52%,transparent)) }
    .failed,.error { color:var(--oneai-red) }

    @keyframes oneai-dot-pulse {
        0%, 100% { transform:scale(1); box-shadow:0 0 0 2px color-mix(in srgb,currentColor 26%,transparent); }
        50% { transform:scale(1.18); box-shadow:0 0 0 4.5px color-mix(in srgb,currentColor 45%,transparent); }
    }
    .dot { width:6.5px; height:6.5px; border-radius:50%; background:currentColor; flex:none; box-sizing:border-box; }
    .dot.running,.dot.working,.running > .dot,.working > .dot {
        box-shadow:0 0 0 2px color-mix(in srgb,var(--oneai-green) 24%,transparent);
        animation:oneai-dot-pulse 1.5s ease-in-out infinite;
    }
    .dot.starting,.dot.waiting,.starting > .dot,.waiting > .dot {
        box-shadow:0 0 0 2px color-mix(in srgb,var(--oneai-amber) 24%,transparent);
        animation:oneai-dot-pulse 1.8s ease-in-out infinite;
    }
    .dot.failed,.dot.error,.failed > .dot,.error > .dot {
        box-shadow:0 0 0 2px color-mix(in srgb,var(--oneai-red) 24%,transparent);
    }
    .dot.stopped,.stopped > .dot {
        background:transparent; border:1.5px solid currentColor;
    }

    .status-badge { display:inline-flex; align-items:center; gap:5px; height:19px; padding:0 7px; white-space:nowrap;
        font-size:var(--oneai-size-small); font-weight:600; line-height:1;
        background:color-mix(in srgb,currentColor 13%,transparent);
        border:1px solid color-mix(in srgb,currentColor 32%,transparent); border-radius:999px; flex:none; }
`;

@Component({
    selector: 'oneai-projects',
    styles: [theme, `
        :host { display:flex; flex:none; min-width:0; max-width:100% }
        .panel { display:flex; flex-direction:column; position:relative; border-inline-end:1px solid var(--oneai-line);
            background:var(--oneai-surface); max-width:41vw; min-height:0 }
        .panel.standalone { max-width:none; width:100%!important; border:0 }
        header { position:relative; display:flex; align-items:center; justify-content:space-between;
            min-height:max(74px,var(--oneai-header-height,0px)); padding:6px 12px 6px 14px; border-bottom:1px solid var(--oneai-line);
            background:linear-gradient(180deg,color-mix(in srgb,var(--oneai-accent) 5%,var(--palette-panel,transparent)),transparent); }
        .workbench-brand { display:flex; align-items:center; gap:10px; min-width:0; line-height:1.22; }
        .brand-logo { width:33px; height:33px; border-radius:9px; display:grid; place-items:center; flex:none;
            color:var(--oneai-accent); background:color-mix(in srgb,var(--oneai-accent) 14%,var(--palette-panel,transparent));
            border:1px solid color-mix(in srgb,var(--oneai-accent) 30%,var(--oneai-line)); }
        .brand-text { display:grid; gap:2px; min-width:0; }
        .brand-title-row { display:flex; align-items:center; gap:6px; }
        .brand-title-row strong { font-size:calc(var(--oneai-size) * 1.06); font-weight:700; }
        .brand-text small { font-size:var(--oneai-size-caption); opacity:.74; }
        .version { font:var(--oneai-size-small) var(--oneai-mono-font,Consolas,monospace); padding:1px 5px; border-radius:5px;
            background:color-mix(in srgb,currentColor 8%,transparent); opacity:.78; }
        .sidebar-toggle { width:28px; height:28px; min-height:28px; padding:0; display:grid; place-items:center;
            color:var(--palette-fg-subtle,inherit); flex:none; }
        .rail header { padding:0; justify-content:center }

        /* 侧栏快速筛选框 */
        .tree-search-wrap { padding:8px 9px 3px; flex:none; }
        .tree-search-box { display:flex; align-items:center; gap:7px; height:30px; padding:0 9px; border-radius:8px;
            background:var(--palette-panel,color-mix(in srgb,currentColor 4%,transparent)); border:1px solid var(--oneai-line); }
        .tree-search-box:focus-within { border-color:var(--oneai-accent); }
        .tree-search-box i { font-size:var(--oneai-size-caption); opacity:.62; }
        .tree-search-box input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:inherit;
            font:inherit; font-size:var(--oneai-size-meta); }

        .tree { overflow-x:hidden; overflow-y:auto; padding:7px 8px 12px; flex:1 1 auto }
        .message { margin:10px; font-size:var(--oneai-size-body) }
        .project { margin-bottom:10px }
        .project-head,.task { display:flex; align-items:center; gap:6px; min-width:0 }
        .project-head { padding:1px 3px 1px 0; border-radius:8px; }
        .project-head:hover,.project-head:focus-within { background:var(--palette-hover,color-mix(in srgb,currentColor 5%,transparent)); }
        .project-name { display:flex; align-items:center; gap:6px; min-width:0; flex:1; padding:4px 5px; text-align:start }
        .project-chevron { width:12px; font-size:var(--oneai-size-small); opacity:.65; flex:none; text-align:center; }
        .project-identity { display:flex; align-items:center; gap:5px; min-width:0; flex:1; }
        .project-title { font-weight:600; }
        .folder-mark { flex:none; width:15px; height:15px; color:var(--oneai-accent); }
        .branch,.runtime-badge { display:inline-flex; flex:none; align-items:center; gap:3px; }
        .branch { font:var(--oneai-size-caption) var(--oneai-mono-font,Consolas,monospace); color:var(--oneai-purple);
            padding:1.5px 6px; border-radius:999px; background:color-mix(in srgb,var(--oneai-purple) 11%,transparent);
            border:1px solid color-mix(in srgb,var(--oneai-purple) 28%,transparent); max-width:74px; }
        .branch svg,.runtime-badge svg { flex:none; width:10px; height:10px; }
        .runtime-badge { font:var(--oneai-size-small) var(--oneai-mono-font,Consolas,monospace); padding:1px 4px;
            border-radius:4px; background:color-mix(in srgb,var(--oneai-accent) 13%,transparent); color:var(--oneai-accent); }
        .runtime-badge.windows { background:color-mix(in srgb,currentColor 7%,transparent); color:inherit; opacity:.75; }
        .project-pin { opacity:0; width:22px; height:22px; min-height:22px; padding:0; border-radius:6px;
            display:grid; place-items:center; color:var(--palette-fg-subtle,inherit); flex:none; font-size:var(--oneai-size-caption); }
        .project-pin i { transform:rotate(38deg); transition:transform .15s; }
        .project-pin.pinned { opacity:1; color:var(--oneai-amber); }
        .project-pin.pinned i { transform:rotate(0deg); }
        .project-head:hover .project-pin,.project-head:focus-within .project-pin { opacity:1; }
        .project-pin:hover { color:var(--oneai-amber); background:var(--palette-control-hover,color-mix(in srgb,currentColor 10%,transparent)); }
        .rail-project { width:34px; height:34px; min-height:34px; padding:0; border-radius:9px; color:var(--oneai-accent);
            display:grid; place-items:center; }

        /* 两级清晰竖横圆角折线：项目 竖横-> 模型(CLI) 竖横-> 会话 */
        .task-list { margin:2px 0 0 14px; padding-inline-start:13px; }
        .cli-sessions { margin:1px 0 3px 13px; padding-inline-start:13px; }
        .branch-node { position:relative; --node-center:14px; }
        .branch-node::before,.branch-node::after { content:''; position:absolute; pointer-events:none; inset-inline-start:-13px; }
        .branch-node::before { top:0; bottom:0; width:1.25px; background:var(--oneai-tree-line); }
        .branch-node::after { top:var(--node-center); width:11px; height:1.25px; background:var(--oneai-tree-line); }
        .branch-node:last-child::before { bottom:auto; height:calc(var(--node-center) + 1px); width:11px; background:transparent;
            border-inline-start:1.25px solid var(--oneai-tree-line); border-bottom:1.25px solid var(--oneai-tree-line);
            border-end-start-radius:6px; }
        .branch-node:last-child::after { display:none; }

        .cli-node-title { display:flex; width:100%; gap:7px; align-items:center; padding:3px 7px;
            font-size:var(--oneai-size-meta); min-height:28px; border-radius:7px; }
        .cli-node-title .cli-chevron { margin-inline-start:auto; font-size:var(--oneai-size-small); opacity:.62; }
        .leaf { --node-center:15px; margin-bottom:2px; }
        .more-node { --node-center:12px; }
        .more-actions { display:flex; align-items:center; gap:2px; }
        .tree-more { min-height:24px; padding:2px 8px; font-size:var(--oneai-size-caption); color:var(--oneai-accent); }
        .tree-collapse { color:var(--palette-fg-subtle,inherit); opacity:.85; }
        .tree-collapse:hover { color:var(--oneai-accent); opacity:1; }

        .task-row { display:flex; gap:3px; align-items:center; border-radius:7px; padding-inline:1px 4px;
            border:1px solid transparent; position:relative; }
        .task-row:hover { background:var(--palette-hover,color-mix(in srgb,currentColor 6%,transparent)); }
        .task-row.opened .session-title { color:var(--palette-fg,inherit); font-weight:500 }
        .task-row.active { background:var(--oneai-active); border-color:color-mix(in srgb,var(--oneai-accent) 36%,transparent); }
        .task-row.active .session-title { color:var(--oneai-accent); font-weight:600 }
        .task { flex:1; min-width:0; gap:7px; padding:4px 5px; text-align:start }
        .session-title { flex:1; min-width:0; font-size:var(--oneai-size-body) }
        .unread-pip,.row-live-badge { flex:none; font-size:var(--oneai-size-small); font-weight:600; padding:1px 5.5px; border-radius:999px;
            line-height:1.25; white-space:nowrap; }
        .unread-pip { color:var(--oneai-amber); background:color-mix(in srgb,var(--oneai-amber) 14%,transparent);
            border:1px solid color-mix(in srgb,var(--oneai-amber) 32%,transparent); }
        .row-live-badge { display:inline-flex; align-items:center; gap:4px;
            background:color-mix(in srgb,currentColor 13%,transparent);
            border:1px solid color-mix(in srgb,currentColor 32%,transparent); }
        .task-icon { flex:none; object-fit:contain; }
        .recent-message { margin:5px 7px 1px; font-size:var(--oneai-size-caption) }
        .recent-task { width:100% }
        .recent-date { flex:none; font-size:var(--oneai-size-caption); font-variant-numeric:tabular-nums }
        .row-hover-actions { display:none; align-items:center; gap:2px; flex:none; }
        .task-row:hover .recent-date,.task-row:hover .unread-pip,.task-row:hover .row-live-badge { display:none; }
        .task-row:hover .row-hover-actions { display:inline-flex; }
        .tiny-action { width:21px; height:21px; min-height:21px; padding:0; border-radius:5px;
            display:grid; place-items:center; color:var(--palette-fg-subtle,inherit); font-size:var(--oneai-size-caption); }
        .tiny-action:hover { color:var(--oneai-accent); background:var(--palette-control-hover,color-mix(in srgb,currentColor 10%,transparent)); }

        footer { border-top:1px solid var(--oneai-line); background:var(--palette-panel,transparent);
            flex:none; padding:9px; display:flex; align-items:center; gap:7px }
        footer button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:34px;
            border:1px solid var(--oneai-line); border-radius:9px; padding:0 8px; }
        .add-project { flex:1; font-size:var(--oneai-size-body); font-weight:600; color:var(--oneai-accent);
            background:var(--oneai-active); border-color:color-mix(in srgb,var(--oneai-accent) 36%,var(--oneai-line)); }
        .add-project:hover { background:color-mix(in srgb,var(--oneai-accent) 23%,var(--oneai-surface)); }
        .folder-settings { flex:none; width:34px; padding:0; background:var(--palette-control,transparent); }
        .folder-error { padding:0 10px 5px; font-size:var(--oneai-size-caption) }
        .rail footer { flex-direction:column; gap:5px; padding:6px 4px }
        .rail footer button { width:34px; min-height:34px; padding:0; }
        .rail .tree { padding:6px 4px }
        .rail .project-head { justify-content:center }
        .resize { position:absolute; inset:0 -3px 0 auto; width:6px; z-index:2; cursor:col-resize; touch-action:none }

        /* 二级弹窗与圆角菜单 */
        dialog { font:inherit; color:inherit; background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--oneai-surface),var(--oneai-surface));
            border:1px solid var(--oneai-line); border-radius:12px; padding:0; width:min(420px,calc(100vw - 24px));
            user-select:text; box-shadow:0 20px 56px #0008; }
        dialog.add-project-dialog { width:min(476px,calc(100vw - 24px)); }
        dialog::backdrop { background:#080e18a8; backdrop-filter:blur(2px); }
        .task-menu { box-sizing:border-box; position:fixed; inset:auto; margin:0; padding:5px; min-width:min(224px,calc(100vw - 16px));
            max-height:calc(100dvh - 16px); overflow:auto; color:inherit;
            background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--oneai-surface),var(--oneai-surface));
            border:1px solid var(--palette-line-strong,var(--oneai-line)); border-radius:11px; box-shadow:0 14px 36px #0007; }
        .task-menu button { display:flex; align-items:center; width:100%; gap:9px; text-align:start; padding:6px 9px; border-radius:7px; }
        .task-menu .launch-row { display:flex; align-items:center; }
        .task-menu .account-launch { width:auto; flex:none; color:var(--oneai-accent); }
        .task-menu .menu-divider { margin-top:4px; border-top:1px solid var(--oneai-line); border-radius:0; padding-top:8px; }
        .task-menu p { margin:3px 8px; }
        form { display:grid; gap:12px; padding:18px }
        form h2 { font-size:calc(var(--oneai-size) * 1.12); margin:0 }
        form label,.field-label { display:grid; gap:5px; font-size:var(--oneai-size-meta); font-weight:600 }
        form [hidden] { display:none }
        form input { font:inherit; font-weight:400; background:var(--palette-control,var(--theme-bg,#141b24)); color:inherit; min-width:0;
            border:1px solid var(--oneai-line); border-radius:8px; padding:7px 10px }
        .modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .modal-title-group { display:grid; gap:3px; min-width:0; }
        .modal-title-group span { font-size:var(--oneai-size-caption); }
        .dialog-close { width:28px; height:28px; min-height:28px; padding:0; border-radius:7px; font-size:18px; line-height:1;
            display:grid; place-items:center; color:var(--palette-fg-subtle,inherit); flex:none; }
        .field-group { display:grid; gap:6px; min-width:0; }
        .env-options { display:flex; flex-wrap:wrap; gap:7px; }
        .env-option { display:inline-flex; align-items:center; gap:7px; min-height:32px; padding:4px 11px; border-radius:8px;
            border:1px solid var(--oneai-line); background:var(--palette-control,color-mix(in srgb,currentColor 5%,transparent));
            font-size:var(--oneai-size-meta); font-weight:500; }
        .env-option.active { background:var(--oneai-active); color:var(--oneai-accent);
            border-color:color-mix(in srgb,var(--oneai-accent) 55%,var(--oneai-line)); font-weight:600; }
        .dir-input-row { display:flex; align-items:stretch; gap:8px; min-width:0; }
        .dir-input-row input { flex:1; }
        .browse-btn { flex:none; display:inline-flex; align-items:center; gap:6px; padding:0 12px; min-height:34px; border-radius:8px;
            border:1px solid var(--oneai-line); background:var(--palette-control,color-mix(in srgb,currentColor 6%,transparent));
            font-size:var(--oneai-size-meta); font-weight:500; white-space:nowrap; }
        .browse-btn:disabled { opacity:.55; cursor:not-allowed; }
        .dir-hint { margin:0; font-size:var(--oneai-size-caption); opacity:.75; line-height:1.45; }
        .cselect-trigger { width:100%; height:34px; padding:0 10px; border-radius:8px; border:1px solid var(--oneai-line);
            background:var(--palette-control,var(--theme-bg,#141b24)); display:flex; align-items:center; justify-content:space-between;
            gap:8px; font-weight:400; }
        .cselect-popover { position:fixed; z-index:99; min-width:200px; padding:5px; border-radius:11px;
            background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--oneai-surface),var(--oneai-surface));
            border:1px solid var(--palette-line-strong,var(--oneai-line));
            box-shadow:0 14px 36px #0007; display:flex; flex-direction:column; gap:2px; }
        .cselect-option { width:100%; padding:7px 9px; border-radius:7px; display:flex; align-items:center; justify-content:space-between; }
        .cselect-option.selected { background:var(--oneai-active); font-weight:600; }
        .action-row { display:flex; justify-content:flex-end; gap:8px; padding-top:4px }
        .action-row button { padding:5px 12px; border-radius:8px; border:1px solid var(--oneai-line);
            background:var(--palette-control,transparent); }
        .primary { color:var(--oneai-accent); background:var(--oneai-active)!important;
            border-color:color-mix(in srgb,var(--oneai-accent) 45%,var(--oneai-line))!important; font-weight:600; }
        .error { margin:0; overflow-wrap:anywhere }
    `],
    template: `
        <section class="panel" [class.rail]="small" [class.standalone]="standalone" [style.width.px]="small ? 48 : width">
            <header>
                <div *ngIf="!small" class="workbench-brand">
                    <span class="brand-logo" aria-hidden="true"><i class="fas fa-terminal"></i></span>
                    <div class="brand-text">
                        <div class="brand-title-row">
                            <strong>{{ i18n.text('AI 工作台', 'AI Workbench') }}</strong>
                            <span class="version">v{{ version }}</span>
                        </div>
                        <small class="ellipsis">{{ i18n.text('Windows 与 WSL 项目会话', 'Windows & WSL Project Sessions') }}</small>
                    </div>
                </div>
                <button *ngIf="!standalone" type="button" class="sidebar-toggle" [attr.aria-expanded]="!small" [title]="small ? i18n.text('展开侧栏', 'Expand sidebar') : i18n.text('折叠侧栏', 'Collapse sidebar')" [attr.aria-label]="small ? i18n.text('展开侧栏', 'Expand sidebar') : i18n.text('折叠侧栏', 'Collapse sidebar')" (click)="workspace.collapsed = !small">
                    <i class="fas" [class.fa-angle-right]="small" [class.fa-angle-left]="!small" aria-hidden="true"></i>
                </button>
            </header>
            <div *ngIf="!small && workspace.projects.length" class="tree-search-wrap">
                <div class="tree-search-box">
                    <i class="fas fa-search" aria-hidden="true"></i>
                    <input type="search" [placeholder]="i18n.text('筛选项目、CLI 或会话…', 'Filter projects, CLIs or sessions…')" [attr.aria-label]="i18n.text('筛选项目、CLI 或会话', 'Filter projects, CLIs or sessions')"
                        [value]="treeQuery" (input)="treeQuery = $any($event.target).value">
                </div>
            </div>
            <div class="tree">
                <p *ngIf="!small && !workspace.projects.length" class="message quiet">{{ i18n.text('添加项目后，可从目录启动 AI CLI。', 'Add a project folder to launch AI CLIs from its directory.') }}</p>
                <section class="project" *ngFor="let project of filteredProjects; trackBy: byId">
                    <div class="project-head" (contextmenu)="openActions($event, project)">
                        <button type="button" *ngIf="!small" class="project-name" (click)="toggle(project)" (keydown.shift.f10)="openActions($event, project)"
                            aria-haspopup="true" [attr.aria-expanded]="!workspace.folded.has(project.id)" [title]="project.name + ' · ' + environment(project) + ' · ' + project.directory">
                            <i class="fas project-chevron" [class.fa-angle-right]="workspace.folded.has(project.id)" [class.fa-angle-down]="!workspace.folded.has(project.id)" aria-hidden="true"></i>
                            <svg class="folder-mark" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" aria-hidden="true"><path d="M2 12.7V4a1 1 0 0 1 1-1h3l1.6 1.8H13a1 1 0 0 1 1 1v1M2 13h10.5a.8.8 0 0 0 .76-.55L15 8.1a.6.6 0 0 0-.56-.8H5.2a1 1 0 0 0-.9.58L2 13Z"/></svg>
                            <span class="project-identity">
                                <span class="project-title ellipsis">{{ project.name }}</span>
                                <span class="runtime-badge" [class.windows]="!project.distro" [title]="project.distro ? 'WSL · ' + project.distro : 'PowerShell 7'" [attr.aria-label]="project.distro ? 'WSL · ' + project.distro : 'Windows'">
                                    <span *ngIf="project.distro; else windowsBadge">{{ wslBadgeLabel(project) }}</span>
                                    <ng-template #windowsBadge><svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M1 1h4.5v4.5H1zM6.5 1H11v4.5H6.5zM1 6.5h4.5V11H1zM6.5 6.5H11V11H6.5z"/></svg></ng-template>
                                </span>
                            </span>
                            <span class="branch" *ngIf="workspace.branches.get(project.id) as branch" [title]="branch">
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4v8M12 5c0 3-1 4.5-4 4.5H4"/><circle cx="4" cy="2.5" r="1.5"/><circle cx="4" cy="13.5" r="1.5"/><circle cx="12" cy="3.5" r="1.5"/></svg><span class="ellipsis">{{ branch }}</span>
                            </span>
                        </button>
                        <button type="button" *ngIf="!small" class="project-pin" [class.pinned]="workspace.isPinned(project)"
                            [title]="(workspace.isPinned(project) ? i18n.text('取消置顶 ', 'Unpin ') : i18n.text('置顶 ', 'Pin ')) + project.name"
                            [attr.aria-label]="(workspace.isPinned(project) ? i18n.text('取消置顶 ', 'Unpin ') : i18n.text('置顶 ', 'Pin ')) + project.name"
                            [attr.aria-pressed]="workspace.isPinned(project)"
                            (click)="togglePin($event, project)">
                            <i class="fas fa-thumbtack" aria-hidden="true"></i>
                        </button>
                        <button type="button" *ngIf="small" class="rail-project" [title]="project.name" [attr.aria-label]="project.name + i18n.text(' 项目操作', ' project actions')"
                            aria-haspopup="true" (click)="openActions($event, project)"><i class="fas fa-folder" aria-hidden="true"></i></button>
                    </div>
                    <div class="task-list" *ngIf="!small && !workspace.folded.has(project.id)">
                        <div *ngFor="let group of groupsFor(project); trackBy: byId" class="cli-node branch-node">
                            <button type="button" class="cli-node-title" [attr.aria-expanded]="!foldedGroups.has(group.id)" (click)="toggleGroup(group.id)"
                                (contextmenu)="openActions($event, project, undefined, group)" (keydown.shift.f10)="openActions($event, project, undefined, group)"
                                aria-haspopup="true" [title]="group.label ? group.name + ' · ' + group.label : group.name">
                                <img class="task-icon" width="15" height="15" [src]="group.icon" [alt]="group.name">
                                <strong>{{ group.name }}</strong>
                                <small *ngIf="group.label" class="status-badge" [ngClass]="group.status">
                                    <span class="dot" [ngClass]="group.status" aria-hidden="true"></span>{{ group.label }}
                                </small>
                                <i class="fas cli-chevron" [class.fa-angle-right]="foldedGroups.has(group.id)" [class.fa-angle-down]="!foldedGroups.has(group.id)" aria-hidden="true"></i>
                            </button>
                            <div *ngIf="!foldedGroups.has(group.id)" class="cli-sessions">
                                <div *ngFor="let row of group.rows; trackBy: byId" class="task-row branch-node leaf" [class.active]="row.task && workspace.selected === row.task"
                                    [class.opened]="row.task?.status === 'running' || row.task?.status === 'starting'"
                                    (contextmenu)="openActions($event, project, row.task || row.entry)" (keydown.shift.f10)="openActions($event, project, row.task || row.entry)">
                                    <button type="button" class="task" [class.recent-task]="row.entry" aria-haspopup="true"
                                        [disabled]="!!row.entry && restoringHistory" [attr.aria-current]="row.task && workspace.selected === row.task ? 'true' : null"
                                        (click)="$event.detail === 0 && openSessionRow(project, row.task || row.entry)" (dblclick)="openSessionRow(project, row.task || row.entry)"
                                        [title]="row.task ? sessionTitle(row.task) : row.title">
                                        <span class="dot" [ngClass]="row.task ? statusDisplay(row.task) : 'stopped'" aria-hidden="true"></span>
                                        <span class="session-title ellipsis">{{ row.title }}</span>
                                        <span *ngIf="row.task && isLiveRow(row.task)" class="row-live-badge" [ngClass]="statusDisplay(row.task)">
                                            {{ taskStatusLabel(row.task) }}
                                        </span>
                                        <span *ngIf="row.task?.unread && !isLiveRow(row.task)" class="unread-pip">{{ i18n.text('新输出', 'New') }}</span>
                                        <time *ngIf="!row.task?.unread && !isLiveRow(row.task) && row.time" class="recent-date quiet" [attr.datetime]="row.time | date:'yyyy-MM-ddTHH:mm:ssZZ'"
                                            [title]="row.time | date:'yyyy-MM-dd HH:mm'">{{ row.time | date:row.dateFormat }}</time>
                                    </button>
                                    <span class="row-hover-actions" *ngIf="group.executable">
                                        <button type="button" class="tiny-action" [title]="i18n.text('查看该会话用量统计', 'View session usage')" [attr.aria-label]="i18n.text('查看用量统计', 'View usage')"
                                            (click)="openQuickPanel($event, 'usage', row.task || row.entry)">
                                            <i class="fas fa-chart-bar" aria-hidden="true"></i>
                                        </button>
                                        <button type="button" class="tiny-action" [title]="i18n.text('查看历史提示词', 'View prompt history')" [attr.aria-label]="i18n.text('查看历史提示词', 'View prompt history')"
                                            (click)="openQuickPanel($event, 'history', row.task || row.entry)">
                                            <i class="fas fa-history" aria-hidden="true"></i>
                                        </button>
                                    </span>
                                </div>
                                <div *ngIf="group.more || group.canCollapse" class="branch-node more-node">
                                    <div class="more-actions">
                                        <button *ngIf="group.more" type="button" class="tree-more" [attr.aria-label]="i18n.text('更多 ' + group.name + ' 会话', 'More ' + group.name + ' sessions')" (click)="showMore(project, group.id, group.limit)">{{ i18n.text('更多会话…', 'More sessions…') }}</button>
                                        <button *ngIf="group.canCollapse" type="button" class="tree-more tree-collapse" [attr.aria-label]="i18n.text('折叠 ' + group.name + ' 会话', 'Collapse ' + group.name + ' sessions')" (click)="collapseMore(group.id)">{{ i18n.text('收起会话', 'Collapse') }}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p *ngIf="!workspace.tasksFor(project).length && !workspace.recentFor(project)?.length" class="recent-message quiet">{{ workspace.recentFor(project) ? i18n.text('暂无会话，右键项目启动 AI CLI', 'No sessions yet. Right-click project to start an AI CLI') : i18n.text('正在读取会话…', 'Loading sessions…') }}</p>
                        <p *ngIf="historyErrorProject === project.id" role="alert" class="recent-message error">{{ i18n.text('无法恢复会话，请检查原目录和运行环境。', 'Unable to restore session. Check directory and runtime environment.') }}</p>
                    </div>
                </section>
            </div>
            <p *ngIf="folderError && !small" class="folder-error error" role="alert">{{ folderError }}</p>
            <footer>
                <button #addButton type="button" class="add-project" [title]="i18n.text('添加项目', 'Add project')" [attr.aria-label]="i18n.text('添加项目', 'Add project')" aria-haspopup="dialog" [disabled]="busy" (click)="openAddProjectDialog()"><i class="fas fa-folder-plus" aria-hidden="true"></i><span *ngIf="!small">{{ i18n.text('添加项目', 'Add Project') }}</span></button>
                <button type="button" class="folder-settings" [title]="i18n.text('工作台设置', 'Workbench Settings')" [attr.aria-label]="i18n.text('设置', 'Settings')" (click)="navigation.open('settings')"><i class="fas fa-cog" aria-hidden="true"></i></button>
            </footer>
            <div *ngIf="!standalone && !small" class="resize" role="separator" [attr.aria-label]="i18n.text('调整侧栏宽度', 'Resize sidebar')" aria-orientation="vertical" tabindex="0"
                (pointerdown)="beginResize($event)" (pointermove)="resize($event)" (keydown.arrowleft)="resizeBy(-12, $event)" (keydown.arrowright)="resizeBy(12, $event)"></div>
        </section>
        <dialog #projectDialog class="add-project-dialog" [attr.aria-label]="i18n.text('添加项目', 'Add Project')" (click)="dismissProjectDialog($event)" (close)="onProjectDialogClose()">
            <form (submit)="saveProject($event)">
                <div class="modal-head">
                    <div class="modal-title-group">
                        <h2>{{ i18n.text('添加项目', 'Add Project') }}</h2>
                        <span class="quiet ellipsis">{{ i18n.text('选择运行环境与项目目录', 'Choose runtime environment and project folder') }}</span>
                    </div>
                    <button type="button" class="dialog-close" [attr.aria-label]="i18n.text('关闭', 'Close')" (click)="projectDialog.close()">×</button>
                </div>
                <div class="field-group">
                    <span class="field-label">{{ i18n.text('运行环境', 'Runtime Environment') }}</span>
                    <div class="env-options" role="radiogroup" [attr.aria-label]="i18n.text('运行环境', 'Runtime Environment')">
                        <button type="button" class="env-option" role="radio" [attr.aria-checked]="!projectDistro" [class.active]="!projectDistro" (click)="selectProjectEnv(undefined)">
                            <i class="fab fa-windows" aria-hidden="true"></i>PowerShell 7
                        </button>
                        <button *ngFor="let distro of projectDistros; trackBy: byValue" type="button" class="env-option" role="radio" [attr.aria-checked]="projectDistro === distro" [class.active]="projectDistro === distro" (click)="selectProjectEnv(distro)">
                            <i class="fas fa-terminal" aria-hidden="true"></i>WSL · {{ distro }}
                        </button>
                    </div>
                </div>
                <div class="field-group">
                    <label class="field-label" for="oneai-project-dir">{{ i18n.text('项目目录', 'Project Folder') }}</label>
                    <div class="dir-input-row">
                        <input #projectDirectory id="oneai-project-dir" type="text" required [value]="projectPath"
                            (input)="projectPath = $any($event.target).value" [placeholder]="projectPathPlaceholder">
                        <button type="button" class="browse-btn" [disabled]="busy || pickingDirectory" (click)="browseProjectDirectory()">
                            <i class="fas fa-folder-open" aria-hidden="true"></i>{{ pickingDirectory ? i18n.text('选择中…', 'Picking…') : i18n.text('选择目录…', 'Browse…') }}
                        </button>
                    </div>
                    <p class="dir-hint">{{ projectPathHint }}</p>
                </div>
                <p *ngIf="error" class="error" role="alert">{{ error }}</p>
                <div class="action-row">
                    <button type="button" (click)="projectDialog.close()">{{ i18n.text('取消', 'Cancel') }}</button>
                    <button class="primary" type="submit" [disabled]="busy || pickingDirectory || !projectPath.trim()">{{ i18n.text('添加', 'Add') }}</button>
                </div>
            </form>
        </dialog>
        <div #actionsMenu popover="auto" class="task-menu actions-menu" role="group" [attr.aria-label]="i18n.text('工作台操作', 'Workbench actions')" (toggle)="focusActions()">
            <button *ngIf="actionGroup" type="button" (click)="startGroup()"><i class="fas fa-play" aria-hidden="true"></i>{{ i18n.text('新建 ' + actionGroup.name + ' 会话', 'New ' + actionGroup.name + ' Session') }}</button>
            <button *ngIf="actionGroup?.executable" type="button" (click)="searchProjectSessions(actionGroup?.executable)"><i class="fas fa-search" aria-hidden="true"></i>{{ i18n.text('查找 ' + actionGroup?.name + ' 历史会话…', 'Search ' + actionGroup?.name + ' History…') }}</button>
            <ng-container *ngIf="!actionGroup && !actionSession">
                <p *ngIf="detecting" class="quiet" role="status">{{ i18n.text('正在检测 CLI…', 'Detecting CLIs…') }}</p>
                <p *ngIf="cliProbeFailed" class="quiet" role="status">{{ i18n.text('CLI 检测失败，可在设置中重试。', 'CLI detection failed. Retry in Settings.') }}</p>
                <p *ngIf="!detecting && !cliProbeFailed && !cliOptions.length" class="quiet" role="status">{{ i18n.text('未检测到当前环境的 AI CLI。', 'No AI CLIs detected in this environment.') }}</p>
                <div *ngFor="let item of cliOptions; trackBy: byExec" class="launch-row">
                    <button type="button" [attr.data-cli]="item.executable" (click)="launchCliFromAction(item)"><img width="16" height="16" [src]="item.source" [class.codex-mark]="item.executable === 'codex'" alt="">{{ item.name }}</button>
                    <button *ngIf="item.executable === 'codex' && accountOptions.length" class="account-launch" type="button" [attr.aria-label]="i18n.text('选择 Codex 账号', 'Choose Codex account')" [title]="i18n.text('选择 Codex 账号', 'Choose Codex account')" (click)="openCustomFromAction()"><i class="fas fa-user" aria-hidden="true"></i></button>
                </div>
                <button *ngIf="actionProject" type="button" [class.menu-divider]="cliOptions.length || detecting || cliProbeFailed" (click)="searchProjectSessions()">
                    <i class="fas fa-search" aria-hidden="true"></i>{{ i18n.text('查找历史会话…', 'Find Session History…') }}
                </button>
                <button *ngIf="actionProject" type="button" (click)="refreshProjectHistoryFromAction()">
                    <i class="fas fa-sync-alt" aria-hidden="true"></i>{{ i18n.text('刷新历史会话', 'Refresh Session History') }}
                </button>
                <button *ngIf="actionProject" type="button" (click)="openProjectFolderFromAction()">
                    <i class="fas fa-folder-open" aria-hidden="true"></i>{{ i18n.text('打开项目文件夹', 'Open Project Folder') }}
                </button>
                <button *ngIf="actionProject" type="button" (click)="togglePinFromAction()">
                    <i class="fas fa-thumbtack" aria-hidden="true"></i>{{ workspace.isPinned(actionProject) ? i18n.text('取消置顶项目', 'Unpin Project') : i18n.text('置顶项目', 'Pin Project') }}
                </button>
            </ng-container>
            <button *ngIf="actionSession" type="button" (click)="openSessionAction()"><i class="fas fa-play" aria-hidden="true"></i>{{ i18n.text('打开会话', 'Open Session') }}</button>
            <button *ngIf="canViewPrompts" type="button" class="view-usage" (click)="viewUsage()"><i class="fas fa-chart-bar" aria-hidden="true"></i>{{ i18n.text('查看用量统计', 'View Usage Analytics') }}</button>
            <button *ngIf="canViewPrompts" type="button" class="view-prompts" (click)="viewPrompts()"><i class="fas fa-history" aria-hidden="true"></i>{{ i18n.text('查看历史提示词', 'View Prompt History') }}</button>
            <button *ngIf="!actionGroup" type="button" class="remove-item" (click)="removeAction()"><i class="fas fa-minus-circle" aria-hidden="true"></i>{{ actionSession ? i18n.text('从工作台移除会话', 'Remove Session from Workbench') : i18n.text('从工作台移除项目', 'Remove Project from Workbench') }}</button>
        </div>
        <dialog #taskDialog [attr.aria-label]="i18n.text('启动 Codex', 'Launch Codex')">
            <form (submit)="saveTask($event, taskName.value)">
                <h2>{{ i18n.text('启动 Codex', 'Launch Codex') }}</h2><span *ngIf="project" class="quiet ellipsis">{{ project.name }} · {{ environment(project) }}</span>
                <label>{{ i18n.text('Codex 账号', 'Codex Account') }}
                    <button #accountTrigger type="button" class="cselect-trigger account-select"
                        [attr.aria-expanded]="accountMenuOpen" (click)="toggleAccountMenu(accountTrigger, $event)">
                        <span class="ellipsis">{{ selectedAccountName }}</span>
                        <i class="fas fa-angle-down" aria-hidden="true"></i>
                    </button>
                </label>
                <div *ngIf="accountMenuOpen" class="cselect-popover" role="listbox"
                    [style.left.px]="accountMenuLeft" [style.top.px]="accountMenuTop" [style.width.px]="accountMenuWidth"
                    (click)="$event.stopPropagation()">
                    <button type="button" class="cselect-option" [class.selected]="accountId === 'default'" (click)="selectAccount('default')">
                        <span>{{ i18n.text('默认账号', 'Default account') }}</span><span style="color:var(--oneai-accent)">{{ accountId === 'default' ? '✓' : '' }}</span>
                    </button>
                    <button *ngFor="let item of accountOptions; trackBy: byId" type="button" class="cselect-option"
                        [class.selected]="accountId === item.id" (click)="selectAccount(item.id)">
                        <span class="ellipsis">{{ item.name }}</span><span style="color:var(--oneai-accent)">{{ accountId === item.id ? '✓' : '' }}</span>
                    </button>
                </div>
                <label>{{ i18n.text('任务名称', 'Task Name') }}<input #taskName [placeholder]="i18n.text('默认使用 Codex', 'Defaults to Codex')" maxlength="60"></label>
                <p *ngIf="error" class="error" role="alert">{{ error }}</p>
                <div class="action-row"><button type="button" (click)="taskDialog.close()">{{ i18n.text('取消', 'Cancel') }}</button><button class="primary" type="submit">{{ i18n.text('启动', 'Launch') }}</button></div>
            </form>
        </dialog>
    `,
})
export class ProjectsComponent implements OnInit, OnDestroy {
    @Input() standalone = false;
    @ViewChild('projectDialog', { static: true }) projectDialog!: ElementRef<HTMLDialogElement>;
    @ViewChild('taskDialog', { static: true }) taskDialog!: ElementRef<HTMLDialogElement>;
    @ViewChild('actionsMenu', { static: true }) actionsMenu!: ElementRef<HTMLElement>;
    @ViewChild('addButton', { static: true }) addButton!: ElementRef<HTMLElement>;
    @ViewChild('projectDirectory') projectDirectoryInput?: ElementRef<HTMLInputElement>;
    actionSession?: Task | HistoryEntry;
    actionGroup?: { executable?: string; name: string };
    private actionProject?: Project;
    private actionAnchor?: HTMLElement;
    width = this.initialWidth();
    treeQuery = '';
    cliOptions: typeof supportedCli = [];
    accountMenuOpen = false;
    accountMenuLeft = 0;
    accountMenuTop = 0;
    accountMenuWidth = 220;
    detecting = false;
    cliProbeFailed = false;
    busy = false;
    pickingDirectory = false;
    restoringHistory = false;
    historyErrorProject?: string;
    readonly foldedGroups = new Set<string>();
    private readonly visibleSessions = new Map<string, number>();
    folderError = '';
    projectDistros: string[] = [];
    projectDistro?: string;
    projectPath = '';
    error = '';
    project?: Project;
    accountId = defaultAccount;
    readonly environment = environment;
    readonly statusDisplay = statusDisplay;
    readonly taskStatusLabel = taskStatusLabel;
    readonly byId = (_: number, item: { id: string }) => item.id;
    readonly byExec = (_: number, item: { executable: string }) => item.executable;
    readonly byValue = (_: number, value: string) => value;
    readonly terminalIcon = terminalIconSource;
    readonly version = pluginVersion;
    readonly cliBrand = cliBrand;
    private langSubscription?: Subscription;

    constructor(
        @Inject(WorkspaceService) readonly workspace: WorkspaceService,
        @Inject(WorkbenchNavigation) readonly navigation: WorkbenchNavigation,
        @Inject(WorkbenchI18n) readonly i18n: WorkbenchI18n,
        @Inject(ChangeDetectorRef) private readonly cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        this.langSubscription = this.i18n.changed$.subscribe(() => this.cdr.markForCheck());
    }

    ngOnDestroy(): void {
        this.langSubscription?.unsubscribe();
    }

    @HostListener('document:click')
    closeAccountMenu(): void {
        this.accountMenuOpen = false;
    }

    get small(): boolean { return !this.standalone && this.workspace.collapsed; }
    get accountOptions() { return this.workspace.codex.accounts.filter(item => item.distro === this.project?.distro); }
    get selectedAccountName(): string {
        if (this.accountId === defaultAccount) return this.i18n.text('默认账号', 'Default account');
        return this.accountOptions.find(item => item.id === this.accountId)?.name ?? this.i18n.text('默认账号', 'Default account');
    }

    private localTreeVersion = 0;
    private cachedProjectsKey = '';
    private cachedProjects: Project[] = [];
    private readonly cachedGroups = new Map<string, { key: string; groups: any[] }>();

    get filteredProjects(): Project[] {
        const q = this.treeQuery.trim().toLowerCase();
        const cacheKey = `${this.workspace.treeVersion}|${this.localTreeVersion}|${this.i18n.lang}|${q}`;
        if (this.cachedProjectsKey === cacheKey) return this.cachedProjects;
        const sorted = [...this.workspace.projects].sort((left, right) => {
            const leftPinned = this.workspace.isPinned(left) ? 1 : 0;
            const rightPinned = this.workspace.isPinned(right) ? 1 : 0;
            if (leftPinned !== rightPinned) return rightPinned - leftPinned;
            return this.workspace.projectUpdatedAt(right) - this.workspace.projectUpdatedAt(left);
        });
        const result = !q ? sorted : sorted.filter(project =>
            project.name.toLowerCase().includes(q) || this.groupsFor(project).length > 0,
        );
        this.cachedProjectsKey = cacheKey;
        this.cachedProjects = result;
        return result;
    }

    wslBadgeLabel(project: Project): string {
        if (!project.distro) return '';
        const distinctDistros = new Set(this.workspace.projects.map(item => item.distro).filter(Boolean));
        return distinctDistros.size > 1 ? `WSL · ${project.distro}` : 'WSL';
    }

    togglePin(event: MouseEvent, project: Project): void {
        event.preventDefault();
        event.stopPropagation();
        this.workspace.togglePin(project);
    }

    togglePinFromAction(): void {
        if (!this.actionProject) return;
        this.workspace.togglePin(this.actionProject);
        this.actionsMenu.nativeElement.hidePopover();
    }

    groupsFor(project: Project) {
        const today = new Date().setHours(0, 0, 0, 0);
        const query = this.treeQuery.trim().toLowerCase();
        const cacheKey = `${this.workspace.treeVersion}|${this.localTreeVersion}|${this.i18n.lang}|${today}|${query}`;
        const hit = this.cachedGroups.get(project.id);
        if (hit && hit.key === cacheKey) return hit.groups;
        const projectMatch = !query || project.name.toLowerCase().includes(query);
        const groups = new Map<string, { id: string; executable?: string; name: string; icon: string; tasks: Task[]; history: HistoryEntry[] }>();
        const groupFor = (executable: string) => {
            const brand = cliBrand(executable);
            const name = brand?.name ?? this.i18n.text('终端', 'Terminal');
            let group = groups.get(name);
            if (!group) {
                group = { id: project.id + ':' + name, executable: brand?.executable, name, icon: brand?.source ?? this.terminalIcon, tasks: [], history: [] };
                groups.set(name, group);
            }
            return group;
        };
        for (const task of this.workspace.tasksFor(project)) groupFor(task.executable).tasks.push(task);
        for (const entry of this.workspace.recentFor(project) ?? []) groupFor(entry.cli?.executable ?? 'codex').history.push(entry);
        const priority = ['working', 'waiting', 'error', 'failed', 'starting', 'ready', 'online'];
        const computed = [...groups.values()].map(group => {
            const task = priority.map(status => group.tasks.find(item => statusDisplay(item) === status)).find(Boolean);
            const allRows: { id: string; title: string; time: number; task?: Task; entry?: HistoryEntry }[] = [];
            for (const item of [...group.tasks].reverse()) allRows.push({ id: item.id, title: item.name, time: this.workspace.sessionUpdatedAt(project, item), task: item });
            for (const entry of group.history) allRows.push({ id: `${entry.scope.key}:${entry.id}`, title: entry.title, time: entry.updatedAt, entry });
            allRows.sort((left, right) => right.time - left.time);
            const latestTime = allRows[0]?.time ?? 0;
            const cliMatch = group.name.toLowerCase().includes(query);
            const rows = projectMatch || cliMatch
                ? allRows
                : allRows.filter(row => row.title.toLowerCase().includes(query));
            const limit = this.visibleSessions.get(group.id) ?? 2;
            return {
                ...group,
                latestTime,
                status: task ? statusDisplay(task) : 'stopped',
                label: task ? taskStatusLabel(task) : '',
                limit,
                rows: rows.slice(0, limit).map(row => ({ ...row, dateFormat: row.time >= today ? 'HH:mm' : 'MM-dd' })),
                more: rows.length > limit || Boolean(group.executable && this.workspace.hasMoreHistory(project, group.executable)),
                canCollapse: limit > 2,
            };
        }).sort((left, right) => right.latestTime - left.latestTime)
            .filter(group => !query || projectMatch || group.name.toLowerCase().includes(query) || group.rows.length > 0);
        this.cachedGroups.set(project.id, { key: cacheKey, groups: computed });
        return computed;
    }

    showMore(project: Project, groupId: string, previous: number): void {
        const limit = previous + 3;
        this.visibleSessions.set(groupId, limit);
        this.localTreeVersion++;
        this.workspace.loadMoreHistory(project, limit);
    }

    collapseMore(groupId: string): void {
        this.visibleSessions.delete(groupId);
        this.localTreeVersion++;
    }

    sessionTitle(task: Task): string {
        return [task.name, taskStatusLabel(task), task.unread ? 'Unread' : '', task.error || task.detail?.summary].filter(Boolean).join(' · ');
    }

    toggleGroup(id: string): void {
        if (!this.foldedGroups.delete(id)) this.foldedGroups.add(id);
    }

    async resumeRecent(entry: HistoryEntry, project: Project): Promise<void> {
        if (this.restoringHistory) return;
        this.restoringHistory = true;
        this.historyErrorProject = undefined;
        try { await this.workspace.restoreHistory(entry); }
        catch { this.historyErrorProject = project.id; }
        finally { this.restoringHistory = false; }
    }

    activateSession(task: Task): void {
        if (task.status === 'stopped' || task.status === 'failed') void this.workspace.start(task);
        else this.workspace.select(task);
    }

    isLiveRow(task?: Task): boolean {
        if (!task) return false;
        const state = statusDisplay(task);
        return state === 'working' || state === 'waiting' || state === 'starting' || state === 'running';
    }

    openSessionRow(project: Project, session?: Task | HistoryEntry): void {
        if (!session) return;
        if ('status' in session) this.activateSession(session);
        else void this.resumeRecent(session, project);
    }

    openQuickPanel(event: MouseEvent, page: 'usage' | 'history', session?: Task | HistoryEntry): void {
        event.preventDefault();
        event.stopPropagation();
        if (session) this.navigation.open(page, session);
    }

    get projectPathPlaceholder(): string {
        return this.projectDistro
            ? '/home/user/project'
            : 'E:\\Project\\MyApp';
    }

    get projectPathHint(): string {
        if (this.projectDistro) {
            return this.i18n.text(
                `可手动输入 Linux 路径（自动将 \\ 转为 /）或 \\\\wsl.localhost\\${this.projectDistro}\\...，也可点「选择目录…」在资源管理器中选择。`,
                `Enter a Linux path (\\ converts to / automatically) or \\\\wsl.localhost\\${this.projectDistro}\\..., or click Browse… to pick a folder.`,
            );
        }
        return this.i18n.text(
            '可手动输入 Windows 目录，或点击右侧「选择目录…」打开系统文件夹窗口。',
            'Enter a Windows folder path, or click Browse… to pick via the system dialog.',
        );
    }

    openAddProjectDialog(): void {
        if (this.busy) return;
        this.folderError = '';
        this.error = '';
        this.pickingDirectory = false;
        this.projectDistro = undefined;
        this.projectPath = '';
        if (this.projectDirectoryInput) this.projectDirectoryInput.nativeElement.value = '';
        const existing = [...new Set(this.workspace.projects.map(item => item.distro).filter((item): item is string => Boolean(item)))];
        this.projectDistros = existing;
        const dialog = this.projectDialog.nativeElement;
        if (!dialog.isConnected) return;
        try {
            if (!dialog.open) dialog.showModal();
        } catch { return; }
        this.cdr.markForCheck();
        setTimeout(() => {
            if (dialog.isConnected && dialog.open) this.projectDirectoryInput?.nativeElement.focus();
        }, 0);
        void distributions().then(found => {
            if (!dialog.isConnected || !dialog.open) return;
            const merged = [...new Set([...found, ...this.projectDistros])];
            if (merged.length !== this.projectDistros.length || merged.some((d, i) => d !== this.projectDistros[i])) {
                this.projectDistros = merged;
                this.cdr.markForCheck();
            }
        }).catch(() => undefined);
    }

    selectProjectEnv(distro?: string): void {
        this.projectDistro = distro;
        this.error = '';
        this.cdr.markForCheck();
    }

    async browseProjectDirectory(): Promise<void> {
        if (this.busy || this.pickingDirectory) return;
        this.pickingDirectory = true;
        this.error = '';
        this.cdr.markForCheck();
        try {
            const picked = await this.workspace.platform.pickDirectory();
            if (!picked) return;
            const resolved = await resolveProjectLocation(picked, this.projectDistro);
            if (!this.projectDialog.nativeElement.isConnected) return;
            if (resolved.distro && !this.projectDistros.includes(resolved.distro)) {
                this.projectDistros = [...this.projectDistros, resolved.distro];
            }
            this.projectDistro = resolved.distro;
            this.projectPath = resolved.directory;
            if (this.projectDirectoryInput) this.projectDirectoryInput.nativeElement.value = resolved.directory;
        } catch (error) {
            this.error = error instanceof Error ? error.message.split('\n')[0] : this.i18n.text('无法读取目录。', 'Unable to read folder.');
        } finally {
            this.pickingDirectory = false;
            this.cdr.markForCheck();
        }
    }

    dismissProjectDialog(event: MouseEvent): void {
        if (this.busy || this.pickingDirectory) return;
        const dialog = this.projectDialog.nativeElement;
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            dialog.close();
        }
    }

    onProjectDialogClose(): void {
        this.pickingDirectory = false;
        this.error = '';
        this.cdr.markForCheck();
    }

    async saveProject(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        const path = this.projectPath.trim();
        if (this.busy || this.pickingDirectory || !path) return;
        this.busy = true;
        this.error = '';
        this.cdr.markForCheck();
        const dialog = this.projectDialog.nativeElement;
        try {
            await this.workspace.addFolder(path, this.projectDistro);
            if (dialog.isConnected && dialog.open) dialog.close();
        } catch (error) {
            this.error = error instanceof Error ? error.message.split('\n')[0] : this.i18n.text('无法添加目录。', 'Unable to add directory.');
        } finally {
            this.busy = false;
            this.cdr.markForCheck();
        }
    }

    private async loadProjectClis(project: Project, menu: HTMLElement, anchor: HTMLElement, pointer?: MouseEvent): Promise<void> {
        this.project = project;
        const cached = this.workspace.cachedCli(project.distro);
        this.cliOptions = supportedCli.filter(cli => cached?.includes(cli.executable));
        this.detecting = cached === undefined;
        this.cliProbeFailed = false;
        if (!menu.isConnected) return;
        try { if (!menu.matches(':popover-open')) menu.showPopover(); } catch { return; }
        this.placeMenu(menu, anchor, pointer);
        if (cached === undefined) {
            try {
                const available = await this.workspace.availableCli(project.distro);
                if (this.project !== project || !menu.isConnected || !menu.matches(':popover-open')) return;
                this.cliOptions = supportedCli.filter(cli => available.includes(cli.executable));
            } catch {
                if (this.project !== project || !menu.isConnected || !menu.matches(':popover-open')) return;
                this.cliProbeFailed = true;
            }
            this.detecting = false;
        }
        setTimeout(() => {
            if (this.project === project && menu.isConnected && menu.matches(':popover-open')) this.placeMenu(menu, anchor, pointer);
        });
    }

    private placeMenu(menu: HTMLElement, anchor: HTMLElement, pointer?: MouseEvent): void {
        const box = anchor.getBoundingClientRect();
        const x = pointer?.clientX ?? box.left;
        const y = pointer?.clientY ?? box.bottom + 4;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    }

    openActions(event: MouseEvent | KeyboardEvent, project: Project, session?: Task | HistoryEntry, group?: { executable?: string; name: string }): void {
        event.preventDefault();
        event.stopPropagation();
        const menu = this.actionsMenu.nativeElement;
        if (!menu.isConnected) return;
        const anchor = event.currentTarget as HTMLElement;
        const pointer = event instanceof MouseEvent && event.type === 'contextmenu' && (event.clientX || event.clientY) ? event : undefined;
        this.actionProject = project;
        this.actionSession = session;
        this.actionGroup = group;
        this.actionAnchor = anchor;
        this.folderError = '';
        if (!group && !session) {
            void this.loadProjectClis(project, menu, anchor, pointer);
            return;
        }
        try { if (!menu.matches(':popover-open')) menu.showPopover(); } catch { return; }
        this.placeMenu(menu, anchor, pointer);
        setTimeout(() => {
            if (this.actionAnchor === anchor && menu.isConnected && menu.matches(':popover-open')) this.placeMenu(menu, anchor, pointer);
        });
    }

    focusActions(): void {
        if (this.actionsMenu.nativeElement.matches(':popover-open')) this.actionsMenu.nativeElement.querySelector('button')?.focus();
    }

    startGroup(): void {
        if (!this.actionProject || !this.actionGroup) return;
        const { executable, name } = this.actionGroup;
        const command = executable ? { executable, args: [] } : terminalCommand(this.actionProject);
        this.actionsMenu.nativeElement.hidePopover();
        this.startCommand(this.actionProject, name, command);
    }

    searchProjectSessions(cli?: string): void {
        if (!this.actionProject) return;
        const project = this.actionProject;
        this.actionsMenu.nativeElement.hidePopover();
        this.navigation.open('search', undefined, project, cli);
    }

    refreshProjectHistoryFromAction(): void {
        const project = this.actionProject;
        if (!project) return;
        this.actionsMenu.nativeElement.hidePopover();
        this.folderError = '';
        void this.workspace.refreshProjectHistory(project);
    }

    async openProjectFolderFromAction(): Promise<void> {
        const project = this.actionProject;
        if (!project) return;
        this.actionsMenu.nativeElement.hidePopover();
        this.folderError = '';
        try {
            await this.workspace.openProjectFolder(project);
        } catch (error) {
            this.folderError = error instanceof Error ? error.message.split('\n')[0] : this.i18n.text('无法打开项目文件夹。', 'Unable to open project folder.');
            this.cdr.markForCheck();
        }
    }

    openSessionAction(): void {
        if (!this.actionProject || !this.actionSession) return;
        this.actionsMenu.nativeElement.hidePopover();
        if ('scope' in this.actionSession) void this.resumeRecent(this.actionSession, this.actionProject);
        else this.activateSession(this.actionSession);
    }

    removeAction(): void {
        if (!this.actionProject) return;
        try {
            if (this.actionSession) this.workspace.removeSession(this.actionProject, this.actionSession);
            else this.workspace.removeProject(this.actionProject);
            this.actionsMenu.nativeElement.hidePopover();
            this.addButton.nativeElement.focus();
        } catch { this.folderError = this.i18n.text('无法保存工作台移除记录。', 'Unable to save removed record.'); }
    }

    get canViewPrompts(): boolean {
        return Boolean(this.actionSession && ('scope' in this.actionSession || this.actionSession.codex || this.actionSession.cliSession || 'status' in this.actionSession));
    }

    viewPrompts(): void {
        this.actionsMenu.nativeElement.hidePopover();
        this.navigation.open('history', this.actionSession);
    }

    viewUsage(): void {
        this.actionsMenu.nativeElement.hidePopover();
        this.navigation.open('usage', this.actionSession);
    }

    launchCliFromAction(cli: typeof supportedCli[number]): void {
        const project = this.actionProject;
        if (!project) return;
        this.actionsMenu.nativeElement.hidePopover();
        this.startCommand(project, cli.name, { executable: cli.executable, args: [] });
    }

    private startCommand(project: Project, name: string, command: ReturnType<typeof terminalCommand>): void {
        const codex = command.executable === 'codex' ? { accountId: this.workspace.codex.preferred(project.distro) } : undefined;
        void this.workspace.createTask(project, name, command, codex);
    }

    openCustom(): void {
        const project = this.project;
        if (!project) return;
        const dialog = this.taskDialog.nativeElement;
        if (this.actionsMenu.nativeElement.matches(':popover-open')) this.actionsMenu.nativeElement.hidePopover();
        this.accountMenuOpen = false;
        this.error = '';
        this.accountId = this.workspace.codex.preferred(project.distro);
        dialog.querySelector('form')?.reset();
        if (!dialog.isConnected) return;
        try { if (!dialog.open) dialog.showModal(); } catch {}
    }

    openCustomFromAction(): void {
        this.project = this.actionProject;
        this.openCustom();
    }

    toggleAccountMenu(trigger: HTMLElement, event: MouseEvent): void {
        event.stopPropagation();
        if (this.accountMenuOpen) {
            this.accountMenuOpen = false;
            return;
        }
        const rect = trigger.getBoundingClientRect();
        this.accountMenuWidth = Math.max(rect.width, 200);
        this.accountMenuLeft = Math.min(Math.max(8, rect.left), window.innerWidth - this.accountMenuWidth - 8);
        this.accountMenuTop = rect.bottom + 5;
        this.accountMenuOpen = true;
    }

    selectAccount(accountId: string): void {
        this.accountId = accountId;
        this.accountMenuOpen = false;
    }

    saveTask(event: SubmitEvent, name: string): void {
        event.preventDefault();
        const project = this.project;
        if (!project) return;
        this.taskDialog.nativeElement.close();
        const codex = { accountId: this.accountId };
        void this.workspace.createTask(project, name.trim() || 'Codex', { executable: 'codex', args: [] }, codex);
    }

    toggle(project: Project): void {
        const folded = this.workspace.folded;
        if (!folded.delete(project.id)) folded.add(project.id);
    }

    beginResize(event: PointerEvent): void {
        if (event.button === 0) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    resize(event: PointerEvent): void {
        if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) this.setWidth(event.clientX);
    }

    resizeBy(delta: number, event: Event): void {
        event.preventDefault();
        this.setWidth(this.width + delta);
    }

    private initialWidth(): number {
        try {
            const raw = Number(localStorage.getItem('tabby-oneai.sidebar.width.v1') ?? '');
            if (Number.isFinite(raw) && raw > 0) return Math.min(420, Math.max(210, Math.round(raw)));
        } catch {}
        return 252;
    }

    private setWidth(width: number): void {
        this.width = Math.min(420, Math.max(210, Math.round(width)));
        try { localStorage.setItem('tabby-oneai.sidebar.width.v1', String(this.width)); } catch {}
    }
}

@Component({
    selector: 'oneai-status',
    styles: [theme, `
        :host { display:block; flex:none; min-width:0; background:var(--oneai-surface); container-type:inline-size }
        .bar { display:flex; align-items:center; padding:5px 12px; gap:8px; min-height:38px; border-bottom:1px solid var(--oneai-line); min-width:0 }
        .icon { color:var(--oneai-accent) }
        strong { font-weight:600 }
        .session-title { flex:0 1 auto; min-width:0 }
        .hint { flex:0 1 auto; min-width:0; margin-inline-start:auto; font-size:var(--oneai-size-meta) }
        .cli-name { display:inline-flex; align-items:center; gap:6px; flex:none; font-weight:600; }
        .session-origin { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:7px;
            border:1px solid var(--oneai-line); background:var(--palette-panel,color-mix(in srgb,currentColor 4%,transparent));
            flex:none; min-width:0; font-size:var(--oneai-size-caption); white-space:nowrap; }
        .origin-project { color:var(--palette-fg-muted,inherit); opacity:.88; max-width:12em; }
        .origin-sep { opacity:.4; flex:none; }
        .origin-runtime { flex:none; font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-small); }
        .origin-runtime.wsl { color:var(--oneai-accent); }

        .metrics { margin-inline-start:auto; display:flex; gap:6px; align-items:center; flex:none;
            font:var(--oneai-size-caption) var(--oneai-mono-font,Consolas,monospace); white-space:nowrap; }
        .metric-pill { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 8px; border-radius:7px; flex:none;
            background:var(--palette-panel,color-mix(in srgb,currentColor 4%,transparent)); border:1px solid var(--oneai-line);
            font-variant-numeric:tabular-nums; }
        button.metric-pill { min-height:26px; }
        button.metric-pill:hover { border-color:color-mix(in srgb,var(--oneai-accent) 52%,var(--oneai-line));
            background:var(--palette-hover,color-mix(in srgb,currentColor 8%,transparent)); }
        .metric-label,.reset-in { color:inherit; opacity:.66; font-size:var(--oneai-size-small); }
        .metric-sep { opacity:.35; }
        .metric-pill strong { font-weight:600; }
        .token strong { color:var(--oneai-purple); }
        .context-val { color:var(--oneai-accent); }
        .context-val.warn { color:var(--oneai-amber); }
        .context-val.danger { color:var(--oneai-red); }
        .model { max-width:135px; }
        .effort { color:var(--oneai-amber); margin-inline-start:-.2em; }
        .mini-bar { width:36px; height:6px; border-radius:99px; background:color-mix(in srgb,currentColor 16%,transparent);
            border:1px solid color-mix(in srgb,currentColor 20%,transparent); overflow:hidden; flex:none; }
        .mini-bar-fill { display:block; height:100%; border-radius:99px; background:var(--oneai-accent); transition:width .24s ease,background-color .2s ease; }
        .mini-bar-fill.warn { background:var(--oneai-amber); }
        .mini-bar-fill.danger { background:var(--oneai-red); }
        .metric-actions { display:inline-flex; align-items:center; gap:3px; margin-inline-start:2px; padding-inline-start:6px; border-inline-start:1px solid var(--oneai-line); }
        .metrics .action-btn { width:26px; height:26px; min-height:26px; padding:0; border-radius:7px; color:var(--oneai-accent);
            display:grid; place-items:center; }

        @container (max-width:74em) { .origin-project,.origin-sep { display:none } }
        @container (max-width:63em) { .metrics .reset-in, .cli-name b { display:none } }
        @container (max-width:46em) { .metrics .model-group, .session-origin { display:none } }
        @container (max-width:35em) { .metrics { gap:4px } .metrics .token { display:none } .bar { gap:5px; padding-inline:6px } }
        @container (max-width:28em) { .bar,.metrics { flex-wrap:wrap } .metrics .aux { display:none } }
    `],
    template: `
        <div class="bar" *ngIf="workspace.selected as task" [attr.aria-label]="i18n.text('任务状态栏', 'Task status bar')">
            <span *ngIf="cliBrand(task.executable) as cli; else terminal" class="cli-name"><img width="16" height="16" [src]="cli.source" [alt]="cli.name"><b>{{ cli.name }}</b></span>
            <ng-template #terminal><i class="icon fas fa-terminal" aria-hidden="true"></i></ng-template>
            <strong class="session-title ellipsis" [title]="task.name">{{ task.name }}</strong>
            <span class="status-badge" [ngClass]="statusDisplay(task)">
                <span class="dot" [ngClass]="statusDisplay(task)" aria-hidden="true"></span>{{ taskStatusLabel(task) }}
            </span>
            <span class="session-origin" *ngIf="workspace.projectFor(task) as project" [title]="(task.directory || project.directory) + ' · ' + environment(project)">
                <span class="origin-project ellipsis">{{ project.name }}</span>
                <span class="origin-sep">/</span>
                <span class="origin-runtime" [class.wsl]="project.distro">{{ project.distro ? (hasMultipleDistros ? 'WSL · ' + project.distro : 'WSL') : 'PS7' }}</span>
            </span>
            <span class="hint error ellipsis" *ngIf="task.error" [title]="task.error">{{ task.error }}</span>
            <div *ngIf="hasAnyMetric(task) || hasMetricActions(task)" class="metrics" aria-label="Session metrics">
                <button *ngIf="hasTokens(task)" type="button" class="metric-pill token" [title]="i18n.text('点击查看当前会话用量统计', 'Click to view session usage')" (click)="navigation.open('usage', task)">
                    <span class="metric-label">Tokens</span><strong>{{ tokens(task) }}</strong>
                </button>
                <span *ngIf="hasQuota(task)" class="metric-pill quota">
                    <ng-container *ngIf="hasQuotaWindow(task.detail?.quota, 'fiveHour')">
                        <span class="metric-label">5h</span>
                        <strong [class]="tone(task.detail?.quota,'fiveHour')" [title]="quotaTitle(task.detail?.quota, 'fiveHour')">{{ percentage(task.detail?.quota,'fiveHour') }}</strong>
                        <span class="reset-in" *ngIf="resetIn(task.detail?.quota,'fiveHour') as reset">{{ reset }}</span>
                    </ng-container>
                    <span *ngIf="hasQuotaWindow(task.detail?.quota, 'fiveHour') && hasQuotaWindow(task.detail?.quota, 'weekly')" class="metric-sep">|</span>
                    <ng-container *ngIf="hasQuotaWindow(task.detail?.quota, 'weekly')">
                        <span class="metric-label">7d</span>
                        <strong [class]="tone(task.detail?.quota,'weekly')" [title]="quotaTitle(task.detail?.quota, 'weekly')">{{ percentage(task.detail?.quota,'weekly') }}</strong>
                        <span class="reset-in" *ngIf="resetIn(task.detail?.quota,'weekly') as reset">{{ reset }}</span>
                    </ng-container>
                </span>
                <span *ngIf="hasModel(task) || hasContext(task)" class="metric-pill model-group" [title]="contextTitle(task)">
                    <ng-container *ngIf="hasModel(task)">
                        <strong class="model ellipsis" [title]="task.detail?.model">{{ task.detail?.model }}</strong>
                        <span *ngIf="task.detail?.effort" class="effort" title="Reasoning effort">/{{ task.detail?.effort }}</span>
                    </ng-container>
                    <span *ngIf="hasModel(task) && hasContext(task)" class="metric-sep">·</span>
                    <ng-container *ngIf="hasContext(task)">
                        <span class="metric-label">Ctx</span>
                        <strong class="context-val" [ngClass]="contextTone(task)">{{ contextUsage(task) }}</strong>
                        <span *ngIf="contextPercent(task) !== undefined" class="mini-bar">
                            <span class="mini-bar-fill" [ngClass]="contextTone(task)" [style.width.%]="contextPercent(task)"></span>
                        </span>
                    </ng-container>
                </span>
                <span class="metric-actions" *ngIf="hasMetricActions(task)">
                    <button *ngIf="task.codex" type="button" class="action-btn" [disabled]="task.refreshing" [title]="task.refreshMessage || i18n.text('刷新账号额度', 'Refresh quota')" [attr.aria-label]="i18n.text('刷新账号额度', 'Refresh quota')" (click)="workspace.refreshQuota(task)"><i class="fas fa-sync-alt" aria-hidden="true"></i></button>
                    <button *ngIf="supportsUsage(task)" type="button" class="action-btn aux" [title]="i18n.text('会话用量', 'Session usage')" [attr.aria-label]="i18n.text('打开用量', 'Open usage')" (click)="navigation.open('usage', task)"><i class="fas fa-chart-bar" aria-hidden="true"></i></button>
                    <button type="button" class="action-btn aux" [title]="i18n.text('会话提示词', 'Session prompts')" [attr.aria-label]="i18n.text('打开历史', 'Open history')" (click)="navigation.open('history', task)"><i class="fas fa-history" aria-hidden="true"></i></button>
                </span>
            </div>
        </div>
    `,
})
export class StatusComponent implements OnInit, OnDestroy {
    showsMetrics(task: Task): boolean {
        const cli = cliBrand(task.executable)?.executable;
        return Boolean(task.codex || cli === 'agy' || cli === 'claude' || cli === 'kimi' || cli === 'grok' || cli === 'pi' || cli === 'opencode' || cli === 'copilot');
    }

    hasTokens(task: Task): boolean {
        return this.showsMetrics(task) && task.detail?.tokens !== undefined;
    }

    hasQuotaWindow(quota: Quota | undefined, key: 'fiveHour' | 'weekly'): boolean {
        return Boolean(quota?.[key]);
    }

    hasQuota(task: Task): boolean {
        return this.showsMetrics(task) && (this.hasQuotaWindow(task.detail?.quota, 'fiveHour') || this.hasQuotaWindow(task.detail?.quota, 'weekly'));
    }

    hasModel(task: Task): boolean {
        return this.showsMetrics(task) && Boolean(task.detail?.model);
    }

    hasContext(task: Task): boolean {
        return this.showsMetrics(task) && this.contextUsage(task) !== '—';
    }

    hasAnyMetric(task: Task): boolean {
        return this.hasTokens(task) || this.hasQuota(task) || this.hasModel(task) || this.hasContext(task);
    }

    supportsUsage(task: Task): boolean {
        return this.showsMetrics(task);
    }

    hasMetricActions(task: Task): boolean {
        return Boolean(task.codex || task.cliSession || this.showsMetrics(task));
    }

    readonly statusDisplay = statusDisplay;
    readonly taskStatusLabel = taskStatusLabel;
    readonly cliBrand = cliBrand;
    readonly environment = environment;
    get hasMultipleDistros(): boolean {
        return new Set(this.workspace.projects.map(item => item.distro).filter(Boolean)).size > 1;
    }
    private readonly format = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
    private langSubscription?: Subscription;
    constructor(
        @Inject(WorkspaceService) readonly workspace: WorkspaceService,
        @Inject(WorkbenchNavigation) readonly navigation: WorkbenchNavigation,
        @Inject(WorkbenchI18n) readonly i18n: WorkbenchI18n,
        @Inject(ChangeDetectorRef) private readonly cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        this.langSubscription = this.i18n.changed$.subscribe(() => this.cdr.markForCheck());
    }

    ngOnDestroy(): void {
        this.langSubscription?.unsubscribe();
    }

    tokens(task: Task): string {
        const tokens = task.detail?.tokens;
        return tokens === undefined ? '—' : this.format.format(tokens);
    }

    contextPercent(task: Task): number | undefined {
        const context = task.detail?.context;
        if (!context) return undefined;
        if (context.percent !== undefined) return Math.min(100, Math.max(0, Math.round(context.percent * 10) / 10));
        if (context.tokens !== undefined && context.window && context.window > 0) {
            return Math.min(100, Math.max(0, Math.round((context.tokens * 1000) / context.window) / 10));
        }
        return undefined;
    }

    contextTone(task: Task): string {
        const pct = this.contextPercent(task);
        if (pct === undefined) return '';
        return pct >= 80 ? 'danger' : pct >= 55 ? 'warn' : '';
    }

    contextUsage(task: Task): string {
        const context = task.detail?.context;
        if (!context) return '—';
        const pct = this.contextPercent(task);
        if (pct !== undefined) return `${pct}%`;
        return context.tokens === undefined ? '—' : this.format.format(context.tokens);
    }

    contextTitle(task: Task): string {
        const context = task.detail?.context;
        if (context?.tokens === undefined) {
            const pct = this.contextPercent(task);
            if (pct === undefined) return task.detail?.model ?? '';
            return context?.window
                ? `${pct}% of ${this.format.format(context.window)} context in use`
                : `${pct}% of context in use`;
        }
        return context.window ? `${this.format.format(context.tokens)} / ${this.format.format(context.window)} tokens in use`
            : `${this.format.format(context.tokens)} tokens in use`;
    }

    percentage(quota: Quota | undefined, key: 'fiveHour' | 'weekly'): string {
        const window = this.freshWindow(quota, key);
        return window ? `${window.remaining}%` : '—';
    }

    tone(quota: Quota | undefined, key: 'fiveHour' | 'weekly'): string {
        const window = this.freshWindow(quota, key);
        if (!window) return 'quiet';
        return window.remaining < 25 ? 'failed' : window.remaining < 60 ? 'starting' : 'running';
    }

    quotaTitle(quota: Quota | undefined, key: 'fiveHour' | 'weekly'): string {
        if (!quota?.[key]) return 'No quota data';
        const window = this.freshWindow(quota, key);
        if (!window) return 'Quota expired. Refresh to update.';
        const reset = window.resetsAt ? ` · Resets ${new Date(window.resetsAt).toLocaleString('en')}` : '';
        const source = { codex: 'Codex', local: 'Local history', agy: 'Antigravity', claude: 'Claude Code' };
        return `${window.remaining}% remaining · ${source[quota.source]}${reset}`;
    }

    resetIn(quota: Quota | undefined, key: 'fiveHour' | 'weekly'): string {
        const window = this.freshWindow(quota, key);
        if (!window) return quota?.[key] ? 'Stale' : '';
        if (window.remaining === 100) return 'Ready';
        if (!window.resetsAt) return '';
        const minutes = Math.max(1, Math.ceil((window.resetsAt - Date.now()) / 60000));
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
    }

    private freshWindow(quota: Quota | undefined, key: 'fiveHour' | 'weekly'): QuotaWindow | undefined {
        if (!quota) return;
        const window = quota[key];
        const expiry = window?.resetsAt ?? quota.updatedAt + (key === 'fiveHour' ? 5 : 168) * 3600000;
        if (expiry > Date.now()) return window;
    }
}

@Component({
    selector: 'oneai-workbench-tab',
    styles: [`:host { display:flex; flex-direction:column; height:100%; min-height:0 } oneai-projects { flex:1 1 auto; min-height:0 }`],
    template: `<oneai-projects [standalone]="true"></oneai-projects>`,
})
export class WorkbenchTab extends BaseTabComponent {
    constructor(@Inject(Injector) injector: Injector, @Inject(WorkbenchI18n) i18n: WorkbenchI18n) {
        super(injector);
        this.setTitle(i18n.text('AI 工作台', 'AI Workbench'));
    }
}
