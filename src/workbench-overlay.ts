import { ChangeDetectorRef, Component, DoCheck, ElementRef, HostListener, Inject, NgZone, OnInit, OnDestroy, ViewChild } from '@angular/core';
import type { Subscription } from 'rxjs';
import { cliBrand, supportedCli } from './cli-icons';
import { distributions } from './commands';
import type { Project } from './commands';
import { WorkbenchNavigation } from './components';
import { ConfigService, HotkeysService } from './host';
import type { HostConfig } from './host';
import { keyboardEventToTabbyStroke, workbenchHotkeys } from './hotkeys';
import { formatTimestamp, WorkbenchI18n } from './i18n';
import type { WorkbenchLanguage } from './i18n';
import { statusDisplay, taskStatusLabel, WorkspaceService } from './workspace';
import type { RemovedSession, Task } from './workspace';
import type { HistoryEntry } from './codex';
import { defaultInterfaceFontSize, interfaceFontSizeRange, interfaceLetterSpacingRange, palettes, WorkbenchAppearance } from './appearance';
import type { AppearanceTheme } from './appearance';

interface SearchSessionItem {
    id: string;
    title: string;
    executable: string;
    cliName: string;
    cliIcon: string;
    time: number;
    timeLabel: string;
    status: string;
    statusLabel: string;
    task?: Task;
    entry?: HistoryEntry;
}

interface SearchCliCount {
    executable: string;
    name: string;
    icon: string;
    count: number;
}

interface RemovedMetaItem {
    record: RemovedSession;
    projectId: string;
    projectName: string;
    distro?: string;
    env: string;
    executable: string;
    cliName: string;
    cliIcon: string;
    removedAtLabel: string;
}

interface RemovedProjectOption {
    id: string;
    name: string;
    env: string;
    count: number;
    latest: number;
}

interface RemovedCliOption {
    executable: string;
    name: string;
    icon: string;
    count: number;
}

interface RemovedProjectGroup {
    projectId: string;
    projectName: string;
    distro?: string;
    latestAt: number;
    items: RemovedMetaItem[];
}

@Component({
    selector: 'oneai-overlay',
    styles: [`
        :host { display:contents; }
        dialog { color:var(--palette-fg,var(--theme-fg,#e1e9f3)); background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--palette-surface,var(--theme-bg-more,#18222e)),var(--palette-surface,var(--theme-bg-more,#18222e)));
            border:1px solid var(--line); font:inherit; border-radius:13px; padding:0;
            width:min(860px, calc(100vw - 28px)); max-height:calc(100dvh - 54px);
            box-shadow:0 24px 68px #0008; --line:var(--palette-line,color-mix(in srgb,currentColor 16%,transparent));
            --accent:var(--palette-accent,light-dark(#066e91,#38bdf8)); overflow:hidden; }
        dialog[open] { display:flex; flex-direction:column; }
        dialog::backdrop { background:color-mix(in srgb,var(--palette-canvas,#06101c) 68%,transparent); backdrop-filter:blur(3px); }
        dialog.settings { box-sizing:border-box; width:min(860px, calc(100vw - 28px)); height:min(620px, calc(100dvh - 54px)); }
        dialog.search { box-sizing:border-box; width:min(760px, calc(100vw - 28px)); height:min(620px, calc(100dvh - 54px)); }
        dialog.usage { box-sizing:border-box; width:min(1100px, calc(100vw - 28px)); height:min(800px, calc(100dvh - 54px)); }
        dialog.history { --history-top:max(44px,var(--oneai-history-top,0px)); box-sizing:border-box;
            width:min(510px, calc(100vw - 24px)); inset-block-start:var(--history-top); margin:0 12px 12px auto;
            height:calc(100dvh - var(--history-top) - 12px); max-height:none; }
        header { display:flex; flex:none; align-items:center; justify-content:space-between; padding:12px 18px;
            border-bottom:1px solid var(--line); background:var(--palette-panel,color-mix(in srgb,currentColor 3%,transparent)); }
        .header-left { display:flex; align-items:center; gap:10px; min-width:0; }
        .header-icon { width:28px; height:28px; border-radius:8px; display:grid; place-items:center;
            background:color-mix(in srgb,var(--accent) 14%,transparent); color:var(--accent); flex:none; }
        h2 { margin:0; font-size:calc(var(--oneai-size) * 1.12); font-weight:600; }
        button,.font-search { font:inherit; color:inherit; border:1px solid var(--line); border-radius:8px;
            background:var(--palette-control,var(--theme-bg,#151c25)); padding:6px 9px; }
        button { cursor:pointer; }
        button:disabled { opacity:.55; cursor:not-allowed; }
        button:hover:not(:disabled) { background:var(--palette-control-hover,color-mix(in srgb,currentColor 10%,transparent)); }
        button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
        .close { background:transparent; border:0; width:30px; height:30px; padding:0; font-size:19px; line-height:1;
            display:grid; place-items:center; border-radius:7px; }
        .settings-body { display:grid; grid-template-columns:186px minmax(0,1fr); grid-template-rows:minmax(0,1fr);
            flex:1; min-height:0; }
        nav { display:flex; flex-direction:column; gap:4px; padding:12px 10px; border-inline-end:1px solid var(--line);
            background:var(--palette-panel,transparent); overflow:auto; }
        nav button { display:flex; align-items:center; gap:9px; padding:8px 10px; border-radius:8px;
            text-align:start; border:1px solid transparent; background:transparent; }
        nav i { width:1.1em; flex:none; opacity:.85; }
        nav .active { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent));
            border-color:color-mix(in srgb,var(--accent) 38%,transparent); color:var(--accent); font-weight:600; }
        .nav-badge { margin-inline-start:auto; font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-small);
            padding:0 5px; border-radius:99px; background:color-mix(in srgb,currentColor 9%,transparent); }

        .settings-page { padding:18px 20px 22px; min-width:0; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:15px; }
        .section-title { margin:0 0 2px; font-size:calc(var(--oneai-size) * 1.15); font-weight:600; }
        .section-desc { margin:0; font-size:var(--oneai-size-meta); color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 72%,transparent)); }
        .setting-card { border:1px solid var(--line); border-radius:9px; padding:14px 15px;
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); display:flex; flex-direction:column; gap:12px; }
        .card-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .card-head strong { font-size:var(--oneai-size-body); white-space:nowrap; flex:none; }
        .card-head small { font-size:var(--oneai-size-caption); color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent)); }

        .typography-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start; }
        .appearance-letter-spacing { grid-column:1 / -1; }
        .segmented { display:inline-flex; padding:3px; border-radius:9px;
            background:var(--palette-panel,color-mix(in srgb,currentColor 5%,transparent)); border:1px solid var(--line); gap:2px; }
        .segmented button { padding:4px 10px; border-radius:6px; border:1px solid transparent; background:transparent;
            font-size:var(--oneai-size-meta); }
        .segmented button.active { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent));
            border-color:color-mix(in srgb,var(--accent) 42%,transparent); font-weight:600; }
        .size-pill { font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-caption); padding:2px 7px; border-radius:6px;
            background:var(--palette-control,transparent); border:1px solid var(--line); color:var(--accent); font-weight:600;
            font-variant-numeric:tabular-nums; }
        .size-actions { display:flex; align-items:center; gap:6px; }
        .font-reset-btn { padding:2px 8px; border-radius:6px; font-size:var(--oneai-size-small); border:1px solid var(--line); }
        .font-size-slider { display:flex; align-items:center; gap:9px; margin-top:8px; }
        input[type=range] { flex:1; width:100%; accent-color:var(--accent); cursor:pointer; }

        /* 统一等高主题色卡网格 */
        .theme-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(136px,1fr)); gap:8px; }
        .theme-grid button { display:flex; align-items:center; gap:9px; height:40px; padding:0 10px; border-radius:9px;
            text-align:start; min-width:0; }
        .theme-grid [aria-pressed="true"] { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent));
            border-color:var(--accent); font-weight:600; box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 28%,transparent); }
        .theme-swatch { width:22px; height:16px; border-radius:5px; border:1px solid color-mix(in srgb,currentColor 28%,transparent);
            display:flex; overflow:hidden; flex:none; }
        .theme-swatch i { flex:1; display:block; }
        .theme-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        /* 圆角自定义下拉与内联字体输入选择器 */
        .cselect-trigger { display:flex; align-items:center; justify-content:space-between; gap:8px;
            width:100%; height:34px; padding:0 10px; border-radius:9px; text-align:start; min-width:0; }
        .cselect-trigger[aria-expanded="true"] { border-color:var(--accent);
            box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent); }
        .cselect-trigger span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .font-combo { display:flex; align-items:center; gap:4px; width:100%; height:34px; padding:0 4px 0 10px;
            border-radius:9px; border:1px solid var(--line); box-sizing:border-box; min-width:0;
            background:var(--palette-control,color-mix(in srgb,currentColor 4%,transparent)); }
        .font-combo:focus-within { border-color:var(--accent); box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent); }
        .font-combo-input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:inherit; font:inherit; padding:0; }
        .font-combo-input::placeholder { color:inherit; opacity:.62; }
        .font-combo-toggle { width:26px; height:26px; min-height:26px; padding:0; border:0; border-radius:6px;
            display:grid; place-items:center; opacity:.75; flex:none; background:transparent; }
        .cselect-popover { position:fixed; inset:auto; margin:0; box-sizing:border-box; z-index:120;
            padding:6px; color:inherit; background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--palette-surface,var(--theme-bg-more,#18222e)),var(--palette-surface,var(--theme-bg-more,#18222e)));
            border:1px solid var(--palette-line-strong,var(--line)); border-radius:11px; box-shadow:0 14px 36px #0007; font:inherit;
            min-width:200px; display:flex; flex-direction:column; gap:2px; }
        .cselect-option { width:100%; padding:7px 9px; border:0; border-radius:7px; background:transparent;
            display:flex; align-items:center; justify-content:space-between; gap:8px; text-align:start; }
        .cselect-option.selected { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent)); font-weight:600; }
        .font-options { position:relative; max-height:184px; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:2px; }
        .font-option { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; margin:0;
            padding:6px 8px; border:1px solid transparent; border-radius:7px; text-align:start; background:transparent; }
        .font-option > span:first-child { min-width:0; overflow-wrap:anywhere; }
        .font-check { flex:none; font-size:var(--oneai-size-caption); opacity:.9; }
        .font-option.highlighted { background:var(--palette-hover,color-mix(in srgb,currentColor 10%,transparent)); }
        .font-option[aria-pressed="true"] { background:var(--palette-selected,color-mix(in srgb,var(--accent) 20%,transparent));
            border-color:color-mix(in srgb,var(--accent) 42%,transparent); color:var(--accent); font-weight:600; }
        .font-empty { margin:5px 8px; font-size:var(--oneai-size-caption); }

        .actions { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
        .neutral-pill { font-size:var(--oneai-size-small); padding:2px 8px; border-radius:999px;
            background:color-mix(in srgb,currentColor 8%,transparent); color:var(--palette-fg-subtle,inherit); }
        .ui-btn-primary { height:32px; padding:0 12px; border-radius:8px; color:var(--accent);
            border-color:color-mix(in srgb,var(--accent) 45%,var(--line));
            background:color-mix(in srgb,var(--accent) 14%,var(--palette-control,transparent)); font-weight:600; }

        /* CLI 双列检测卡片与统一状态胶囊 */
        .cli-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
        .cli-card { padding:11px 13px; border-radius:9px; border:1px solid var(--line);
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent));
            display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .cli-identity { display:flex; align-items:center; gap:10px; min-width:0; }
        .cli-identity strong { display:block; }
        .cli-identity code { display:block; font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-caption); opacity:.68; }

        .state-badge { display:inline-flex; align-items:center; gap:5px; height:19px; padding:0 7px; border-radius:999px;
            font-size:var(--oneai-size-small); font-weight:600; white-space:nowrap;
            color:var(--state-color); background:color-mix(in srgb,var(--state-color) 13%,transparent);
            border:1px solid color-mix(in srgb,var(--state-color) 32%,transparent); }
        .state-badge::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
        .detected { --state-color:var(--palette-success,light-dark(#096b4c,#34d399)); }
        .undetected { --state-color:var(--palette-warning,light-dark(#895c06,#fbbf24)); }

        .settings-list { border:1px solid var(--line); border-radius:9px; overflow:hidden;
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); }
        .shortcut-row,.removed-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; }
        .removed-row { gap:10px; padding:6px 12px; min-height:36px; transition:background .12s; }
        .removed-row:hover { background:var(--palette-hover,color-mix(in srgb,currentColor 4%,transparent)); }
        .removed-main { display:flex; align-items:center; gap:8px; min-width:0; flex:1; }
        .removed-title { font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .removed-actions { display:flex; align-items:center; gap:9px; flex:none; }
        .removed-time { font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-caption); opacity:.68; white-space:nowrap;
            font-variant-numeric:tabular-nums; }
        .ui-btn-compact { height:26px; padding:0 9px; font-size:var(--oneai-size-caption); border-radius:7px; }
        .removed-row button { flex:none; }
        .settings-list > :not(:last-child) { border-bottom:1px solid var(--line); }

        /* 会话管理：筛选栏与按项目分组卡片 */
        .sessions-filter-bar { display:grid; grid-template-columns:170px 150px minmax(0,1fr); gap:8px; align-items:center; }
        .filter-input-box { display:flex; align-items:center; gap:7px; height:34px; padding:0 10px; border-radius:9px;
            border:1px solid var(--line); background:var(--palette-control,var(--theme-bg,#151c25)); }
        .filter-input-box:focus-within { border-color:var(--accent); }
        .filter-input-box i { font-size:var(--oneai-size-caption); opacity:.62; }
        .filter-input-box input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:inherit; font:inherit; font-size:var(--oneai-size-meta); }
        .removed-groups { display:flex; flex-direction:column; gap:9px; }
        .removed-group-card { border:1px solid var(--line); border-radius:10px; overflow:hidden;
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); }
        .removed-group-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px;
            background:var(--palette-panel,color-mix(in srgb,currentColor 3%,transparent)); border-bottom:1px solid var(--line); }
        .removed-group-head.collapsed { border-bottom:0; }
        .group-toggle-btn { display:flex; align-items:center; gap:8px; border:0; background:transparent; padding:2px 4px;
            min-width:0; flex:1; text-align:start; font-weight:600; }
        .group-toggle-btn:hover { background:transparent!important; color:var(--accent); }
        .env-tag,.cli-tag { display:inline-flex; align-items:center; gap:4px; font-family:var(--oneai-mono-font,Consolas,monospace);
            font-size:var(--oneai-size-small); padding:1.5px 6px; border-radius:5px; white-space:nowrap; font-weight:500; }
        .env-tag { background:color-mix(in srgb,var(--accent) 13%,transparent); color:var(--accent); }
        .env-tag.win { background:color-mix(in srgb,currentColor 8%,transparent); color:inherit; opacity:.78; }
        .cli-tag { background:color-mix(in srgb,currentColor 8%,transparent); opacity:.82; }
        .ui-btn-subtle { height:27px; padding:0 9px; font-size:var(--oneai-size-caption); border-radius:7px; }

        /* 查找历史会话弹窗 */
        .search-page { flex:1; min-height:0; display:flex; flex-direction:column; }
        .search-toolbar { flex:none; padding:13px 18px 11px; border-bottom:1px solid var(--line);
            background:color-mix(in srgb,var(--palette-panel,transparent) 50%,var(--palette-surface,transparent));
            display:flex; flex-direction:column; gap:10px; }
        .search-top-row { display:flex; align-items:center; gap:8px; }
        .search-top-row .filter-input-box { flex:1; height:35px; }
        .search-cli-pills { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .cli-filter-pill { display:inline-flex; align-items:center; gap:6px; height:27px; padding:0 10px; border-radius:999px;
            font-size:var(--oneai-size-caption); border:1px solid var(--line); background:var(--palette-control,transparent); }
        .cli-filter-pill.active { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent));
            border-color:color-mix(in srgb,var(--accent) 44%,transparent); color:var(--accent); font-weight:600; }
        .cli-filter-pill small { font-family:var(--oneai-mono-font,Consolas,monospace); opacity:.75; }
        .search-body { flex:1; min-height:0; overflow-y:auto; padding:12px 18px; display:flex; flex-direction:column; gap:7px; }
        .search-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 13px;
            border:1px solid var(--line); border-radius:9px;
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); transition:border-color .12s,background .12s; }
        .search-row:hover { border-color:color-mix(in srgb,var(--accent) 38%,var(--line));
            background:var(--palette-hover,color-mix(in srgb,currentColor 6%,transparent)); }
        .search-row-main { display:flex; align-items:center; gap:11px; min-width:0; flex:1; cursor:pointer; }
        .search-row-info { min-width:0; flex:1; }
        .search-row-title { display:flex; align-items:center; gap:8px; min-width:0; }
        .search-row-title strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--oneai-size-body); }
        .search-row-meta { display:flex; align-items:center; gap:7px; margin-top:3px; font-size:var(--oneai-size-caption); opacity:.74; }
        .search-row-actions { display:flex; align-items:center; gap:6px; flex:none; }
        .icon-action { width:30px; height:30px; padding:0; display:grid; place-items:center; border-radius:7px;
            color:var(--palette-fg-subtle,inherit); }
        .icon-action:hover { color:var(--accent); }
        .search-status-badge { display:inline-flex; align-items:center; gap:4px; height:18px; padding:0 6px; border-radius:999px;
            font-size:var(--oneai-size-small); font-weight:600;
            background:color-mix(in srgb,currentColor 13%,transparent); border:1px solid color-mix(in srgb,currentColor 32%,transparent); }
        .search-status-badge.running,.search-status-badge.working { color:var(--palette-success,light-dark(#146c43,#34d399)); }
        .search-status-badge.ready,.search-status-badge.online { color:var(--accent); }
        .search-status-badge.starting,.search-status-badge.waiting { color:var(--palette-warning,light-dark(#845500,#fbbf24)); }
        .search-status-badge.failed,.search-status-badge.error { color:var(--palette-danger,light-dark(#a52237,#fb7185)); }
        .search-status-badge.stopped { color:var(--palette-fg-faint,color-mix(in srgb,currentColor 55%,transparent)); }
        .search-footer { flex:none; padding:9px 18px; border-top:1px solid var(--line); display:flex; align-items:center;
            justify-content:space-between; font-size:var(--oneai-size-caption); opacity:.75;
            background:var(--palette-panel,color-mix(in srgb,currentColor 3%,transparent)); }

        kbd { font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-caption); color:inherit;
            background:var(--palette-control,var(--theme-bg,#161c22)); border:1px solid var(--palette-line-strong,var(--line));
            padding:3px 8px; border-radius:6px; }
        kbd.unbound { border-style:dashed; border-color:var(--line); background:transparent; opacity:.62; }
        .shortcut-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .shortcut-info { display:flex; flex-direction:column; gap:2px; min-width:0; }
        .shortcut-info small { font-size:var(--oneai-size-caption); font-family:var(--oneai-mono-font,Consolas,monospace); }
        .shortcut-controls { display:flex; align-items:center; gap:6px; flex:none; }
        .hotkey-recorder { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border-radius:7px;
            font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-caption); color:inherit;
            border:1px solid var(--palette-line-strong,var(--line)); background:var(--palette-control,var(--theme-bg,#161c22)); }
        .hotkey-recorder.unbound { border-style:dashed; background:transparent; opacity:.76; }
        .hotkey-recorder.recording { border-color:var(--accent); color:var(--accent);
            background:color-mix(in srgb,var(--accent) 14%,transparent);
            box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 22%,transparent); }
        .hotkey-clear { width:28px; height:28px; padding:0; display:grid; place-items:center; border-radius:7px; opacity:.72; }
        .hotkey-clear:hover:not(:disabled) { opacity:1; color:var(--palette-danger,light-dark(#9b3448,#ffa7b3)); }
        .shortcut-status { margin:0; font-size:var(--oneai-size-meta); color:var(--palette-success,light-dark(#096b4c,#34d399)); }
        .shortcut-warning { margin:0; font-size:var(--oneai-size-meta); color:var(--palette-warning,light-dark(#895c06,#fbbf24)); }
        .muted { color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 72%,transparent)); }
        dialog.confirm-close { width:min(460px, calc(100vw - 24px)); max-height:calc(100dvh - 48px); }
        .confirm-warn { background:color-mix(in srgb,var(--palette-warning,light-dark(#895c06,#fbbf24)) 16%,transparent);
            color:var(--palette-warning,light-dark(#895c06,#fbbf24)); }
        .confirm-body { padding:16px 18px; display:flex; flex-direction:column; gap:12px; min-height:0; overflow:auto; }
        .confirm-body p { margin:0; line-height:1.5; color:var(--palette-fg-muted,inherit); }
        .confirm-list { display:flex; flex-direction:column; gap:7px; max-height:220px; overflow:auto; }
        .confirm-item { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border-radius:9px;
            border:1px solid var(--line); background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); min-width:0; }
        .confirm-item-main { display:flex; align-items:center; gap:9px; min-width:0; flex:1; }
        .confirm-item-main img { flex:none; }
        .confirm-item-text { display:grid; gap:2px; min-width:0; }
        .confirm-item-text strong { font-size:var(--oneai-size-body); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .confirm-item-text small { font-size:var(--oneai-size-caption); color:var(--palette-fg-subtle,inherit); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .confirm-pill { display:inline-flex; align-items:center; gap:5px; height:20px; padding:0 8px; border-radius:999px;
            font-size:var(--oneai-size-small); font-weight:600; flex:none;
            background:color-mix(in srgb,currentColor 13%,transparent); border:1px solid color-mix(in srgb,currentColor 32%,transparent); }
        .confirm-pill.working { color:var(--palette-success,light-dark(#146c43,#34d399)); }
        .confirm-pill.waiting,.confirm-pill.starting { color:var(--palette-warning,light-dark(#895c06,#fbbf24)); }
        .confirm-actions { display:flex; justify-content:flex-end; gap:8px; padding:12px 18px; border-top:1px solid var(--line);
            background:var(--palette-panel,color-mix(in srgb,currentColor 3%,transparent)); }
        .confirm-keep { background:color-mix(in srgb,var(--accent) 18%,transparent); color:var(--accent);
            border-color:color-mix(in srgb,var(--accent) 45%,var(--line)); font-weight:600; }
        .confirm-danger { color:var(--palette-danger,light-dark(#a52237,#fb7185));
            border-color:color-mix(in srgb,var(--palette-danger,light-dark(#a52237,#fb7185)) 42%,var(--line)); font-weight:600; }
        .confirm-danger:hover { background:color-mix(in srgb,var(--palette-danger,light-dark(#a52237,#fb7185)) 14%,transparent)!important; }
        .error { flex:none; padding:0 18px; color:var(--palette-danger,light-dark(#9b3448,#ffa7b3)); }
        @media (max-width:680px) {
            .settings-body { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); }
            nav { flex-direction:row; white-space:nowrap; border-inline-end:0; border-bottom:1px solid var(--line); }
            nav button { flex:none; }
            .typography-grid,.cli-grid,.sessions-filter-bar { grid-template-columns:1fr; }
        }
    `],
    template: `
        <dialog #dialog [class.history]="page === 'history'" [class.settings]="page === 'settings'" [class.usage]="page === 'usage'" [class.search]="page === 'search'"
            [attr.aria-label]="dialogTitle" (cancel)="onDialogCancel($event)" (close)="onClose()" (click)="dismissBackdrop($event)">
            <header>
                <div class="header-left">
                    <span class="header-icon" aria-hidden="true"><i class="fas" [ngClass]="icons[page]"></i></span>
                    <h2>{{ dialogTitle }}</h2>
                    <span *ngIf="page === 'search' && searchProject as proj" class="env-tag" [class.win]="!proj.distro">
                        {{ proj.distro ? 'WSL · ' + proj.distro : 'PS7' }}
                    </span>
                </div>
                <button type="button" class="close" [attr.aria-label]="i18n.text('关闭', 'Close')" (click)="closeDialog()">×</button>
            </header>
            <oneai-session-panel *ngIf="visible && (page === 'history' || page === 'usage')" [page]="page === 'usage' ? 'usage' : 'history'" [session]="session"></oneai-session-panel>

            <!-- 查找历史会话视图 -->
            <div *ngIf="visible && page === 'search'" class="search-page">
                <div class="search-toolbar">
                    <div class="search-top-row">
                        <div class="filter-input-box">
                            <i class="fas fa-search" aria-hidden="true"></i>
                            <input type="search" [placeholder]="i18n.text('输入关键词搜索该项目下的会话标题…', 'Search session titles in this project…')"
                                [attr.aria-label]="i18n.text('搜索项目历史会话', 'Search project session history')"
                                [value]="searchQuery" (input)="onSearchQueryInput($any($event.target).value)">
                        </div>
                        <button type="button" class="ui-btn-primary" [disabled]="searchLoading" (click)="loadProjectSearch()">
                            {{ searchLoading ? i18n.text('加载中…', 'Loading…') : i18n.text('刷新', 'Refresh') }}
                        </button>
                    </div>
                    <div class="search-cli-pills" *ngIf="searchCliCounts.length > 1">
                        <button type="button" class="cli-filter-pill" [class.active]="!searchCliFilter" (click)="setSearchCliFilter('')">
                            <span>{{ i18n.text('全部', 'All') }}</span><small>{{ searchAllItems.length }}</small>
                        </button>
                        <button *ngFor="let cli of searchCliCounts; trackBy: trackByExecutable" type="button" class="cli-filter-pill"
                            [class.active]="searchCliFilter === cli.executable" (click)="setSearchCliFilter(cli.executable)">
                            <img *ngIf="cli.icon" width="13" height="13" [src]="cli.icon" [class.codex-mark]="cli.executable === 'codex'" alt="">
                            <span>{{ cli.name }}</span>
                            <small>{{ cli.count }}</small>
                        </button>
                    </div>
                </div>
                <div class="search-body">
                    <p *ngIf="searchLoading && !searchAllItems.length" class="muted" style="text-align:center;padding:32px 0">
                        {{ i18n.text('正在扫描项目历史会话…', 'Scanning project session history…') }}
                    </p>
                    <ng-container *ngIf="!searchLoading || searchAllItems.length">
                        <div *ngFor="let item of filteredSearchItems; trackBy: trackById" class="search-row">
                            <div class="search-row-main" (click)="activateFromSearch(item)" [title]="i18n.text('点击打开会话：', 'Open session: ') + item.title">
                                <img *ngIf="item.cliIcon" width="18" height="18" [src]="item.cliIcon" [class.codex-mark]="item.executable === 'codex'" [alt]="item.cliName">
                                <div class="search-row-info">
                                    <div class="search-row-title">
                                        <strong>{{ item.title }}</strong>
                                        <span class="search-status-badge" [ngClass]="item.status">{{ item.statusLabel }}</span>
                                    </div>
                                    <div class="search-row-meta">
                                        <span>{{ item.cliName }}</span>
                                        <span *ngIf="item.timeLabel">·</span>
                                        <time *ngIf="item.timeLabel">{{ item.timeLabel }}</time>
                                    </div>
                                </div>
                            </div>
                            <div class="search-row-actions">
                                <button type="button" class="icon-action" [title]="i18n.text('查看该会话用量统计', 'View session usage')"
                                    [attr.aria-label]="i18n.text('查看用量统计', 'View usage')"
                                    (click)="openFromSearch('usage', item)">
                                    <i class="fas fa-chart-bar" aria-hidden="true"></i>
                                </button>
                                <button type="button" class="icon-action" [title]="i18n.text('查看该会话历史提示词', 'View session prompt history')"
                                    [attr.aria-label]="i18n.text('查看历史提示词', 'View prompt history')"
                                    (click)="openFromSearch('history', item)">
                                    <i class="fas fa-history" aria-hidden="true"></i>
                                </button>
                                <button type="button" class="ui-btn-primary" [disabled]="searchOpening"
                                    (click)="activateFromSearch(item)">
                                    {{ item.task && (item.task.status === 'running' || item.task.status === 'starting') ? i18n.text('切换', 'Focus') : i18n.text('打开', 'Open') }}
                                </button>
                            </div>
                        </div>
                        <div *ngIf="!filteredSearchItems.length" class="setting-card" style="align-items:center;padding:32px;text-align:center;margin-top:8px">
                            <strong>{{ searchAllItems.length ? i18n.text('没有匹配筛选条件的历史会话', 'No matching sessions') : i18n.text('该项目暂无历史会话记录', 'No session history found for this project') }}</strong>
                            <small class="muted">{{ searchAllItems.length ? i18n.text('请尝试更换搜索关键词或切换上方的 CLI 筛选标签。', 'Try changing the search keyword or switching the CLI filter.') : i18n.text('可在左侧右键该项目新建 AI CLI 会话。', 'Right-click this project in the sidebar to start a new AI CLI session.') }}</small>
                        </div>
                    </ng-container>
                </div>
                <footer class="search-footer">
                    <span>{{ i18n.text('显示 ' + filteredSearchItems.length + ' / ' + searchAllItems.length + ' 条会话（按最近活动时间倒序）', 'Showing ' + filteredSearchItems.length + ' / ' + searchAllItems.length + ' sessions (newest first)') }}</span>
                    <span>{{ i18n.text('点击会话行可直接在终端中打开或恢复', 'Click a session row to open or resume in terminal') }}</span>
                </footer>
            </div>
            <div *ngIf="visible && page === 'settings'" class="settings-body">
                <nav [attr.aria-label]="i18n.text('工作台设置分类', 'Workbench settings sections')">
                    <button *ngFor="let item of sections; trackBy: trackByKey" type="button" [class.active]="section === item.key" [attr.aria-pressed]="section === item.key" (click)="selectSection(item.key)">
                        <i class="fas" [ngClass]="item.icon" aria-hidden="true"></i>
                        <span>{{ item.label }}</span>
                        <span *ngIf="item.key === 'sessions' && workspace.removedSessions.length" class="nav-badge">{{ workspace.removedSessions.length }}</span>
                    </button>
                </nav>
                <ng-container [ngSwitch]="section">
                    <div *ngSwitchCase="'appearance'" class="settings-page">
                        <div>
                            <h3 class="section-title">{{ i18n.text('外观与排版', 'Appearance & Typography') }}</h3>
                            <p class="section-desc">{{ i18n.text('自定义工作台语言、字号、字体及配色主题，更改会立即生效。', 'Customize workbench language, font size, font family, and color theme. Changes take effect immediately.') }}</p>
                        </div>

                        <section class="setting-card" [attr.aria-label]="i18n.text('工作台语言设置', 'Workbench language setting')">
                            <div class="card-head">
                                <strong>{{ i18n.text('界面语言', 'Interface Language') }}</strong>
                                <small>{{ i18n.text('与 Tabby 界面语言相互独立', 'Independent from Tabby UI language') }}</small>
                            </div>
                            <div class="segmented" role="group" [attr.aria-label]="i18n.text('界面语言', 'Interface Language')">
                                <button type="button" [class.active]="i18n.lang === 'zh'" [attr.aria-pressed]="i18n.lang === 'zh'"
                                    (click)="setLanguage('zh')">简体中文</button>
                                <button type="button" [class.active]="i18n.lang === 'en'" [attr.aria-pressed]="i18n.lang === 'en'"
                                    (click)="setLanguage('en')">English</button>
                            </div>
                        </section>

                        <section class="setting-card" [attr.aria-label]="i18n.text('排版与字体设置', 'Typography settings')">
                            <div class="typography-grid">
                                <div class="appearance-font-size">
                                    <div class="card-head" style="margin-bottom:8px">
                                        <strong id="oneai-font-size-label">{{ i18n.text('工作台字号', 'Font Size') }}</strong>
                                        <span class="size-actions">
                                            <button *ngIf="appearance.fontSize !== defaultSize" type="button" class="font-reset-btn"
                                                (click)="resetAppearanceSize()">{{ i18n.text('恢复默认', 'Reset') }}</button>
                                            <span class="size-pill">{{ appearance.fontSize }} px</span>
                                        </span>
                                    </div>
                                    <label class="font-size-slider">
                                        <small class="muted">{{ appearanceSizeRange.min }}</small>
                                        <input type="range" [attr.aria-label]="i18n.text('工作台字号', 'Font Size')" [min]="appearanceSizeRange.min" [max]="appearanceSizeRange.max"
                                            [value]="appearance.fontSize" (input)="setAppearanceSize($any($event.target).valueAsNumber)">
                                        <small class="muted">{{ appearanceSizeRange.max }}</small>
                                    </label>
                                </div>

                                <div class="appearance-font">
                                    <div class="card-head" style="margin-bottom:8px">
                                        <strong id="oneai-font-label">{{ i18n.text('工作台字体', 'Font Family') }}</strong>
                                        <span class="size-actions">
                                            <button *ngIf="appearance.fontFamily" type="button" class="font-reset-btn"
                                                (click)="selectAppearanceFont('')">{{ i18n.text('恢复默认', 'Reset') }}</button>
                                            <small>{{ i18n.text('可输入/复制字体名', 'Type or copy font') }}</small>
                                        </span>
                                    </div>
                                    <div #fontCombo class="font-combo" (click)="$event.stopPropagation()">
                                        <input #fontInput type="text" class="font-combo-input"
                                            aria-labelledby="oneai-font-label" aria-autocomplete="list"
                                            [attr.aria-expanded]="fontMenuOpen" aria-controls="oneai-font-menu"
                                            [placeholder]="i18n.text('默认（Noto Sans SC + Cascadia Code）', 'Default (Noto Sans SC · Cascadia Code)')"
                                            [value]="fontInputValue"
                                            (focus)="onFontFocus(fontCombo)"
                                            (click)="onFontClick(fontCombo)"
                                            (input)="onFontInput($any($event.target).value, fontCombo)"
                                            (keydown)="onFontKeydown($event, fontInput)"
                                            (blur)="onFontBlur()">
                                        <button type="button" class="font-combo-toggle" tabindex="-1"
                                            [attr.aria-label]="i18n.text('展开字体列表', 'Toggle font list')"
                                            (mousedown)="$event.preventDefault()"
                                            (click)="toggleFontDropdown(fontCombo, fontInput)">
                                            <i class="fas fa-angle-down" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                    <div *ngIf="fontMenuOpen" id="oneai-font-menu" class="cselect-popover font-combo-popover" role="listbox"
                                        [style.left.px]="fontMenuLeft" [style.top.px]="fontMenuTop" [style.bottom]="fontMenuBottom"
                                        [style.width.px]="fontMenuWidth" [style.max-height.px]="fontMenuMaxHeight"
                                        (mousedown)="$event.preventDefault()" (click)="$event.stopPropagation()">
                                        <div class="font-options">
                                            <button *ngIf="showDefaultFontOption" type="button" class="font-option"
                                                [attr.aria-pressed]="!appearance.fontFamily" [class.highlighted]="fontHighlight === -1"
                                                (mousedown)="$event.preventDefault()" (click)="selectAppearanceFont('', fontInput)">
                                                <span>{{ i18n.text('默认（Noto Sans SC + Cascadia Code）', 'Default (Noto Sans SC · Cascadia Code)') }}</span>
                                                <span *ngIf="!appearance.fontFamily" class="font-check" aria-hidden="true">✓</span>
                                            </button>
                                            <button *ngFor="let font of matchingFonts; let idx = index; trackBy: trackByValue" type="button"
                                                class="font-option" [attr.aria-pressed]="isFontSelected(font)" [class.highlighted]="fontHighlight === idx"
                                                (mousedown)="$event.preventDefault()" (click)="selectAppearanceFont(font, fontInput)">
                                                <span>{{ font }}</span>
                                                <span *ngIf="isFontSelected(font)" class="font-check" aria-hidden="true">✓</span>
                                            </button>
                                            <p *ngIf="fontsLoading && !fontFamilies.length" class="muted font-empty" role="status">{{ i18n.text('正在读取本机字体…', 'Loading installed fonts…') }}</p>
                                            <p *ngIf="fontEditing && fontQuery.trim() && !matchingFonts.length" class="muted font-empty" role="status">{{ i18n.text('按 Enter 使用当前字体名，或清空恢复默认', 'Press Enter to apply custom font name, or clear to reset') }}</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="appearance-letter-spacing">
                                    <div class="card-head" style="margin-bottom:4px">
                                        <strong id="oneai-letter-spacing-label">{{ i18n.text('工作台字间距', 'Letter Spacing') }}</strong>
                                        <span class="size-actions">
                                            <button *ngIf="!appearance.isAutoLetterSpacing" type="button" class="font-reset-btn"
                                                (click)="resetAppearanceLetterSpacing()">{{ i18n.text('恢复自动', 'Auto') }}</button>
                                            <span class="size-pill spacing-pill">{{ formatLetterSpacing(appearance.letterSpacing, appearance.isAutoLetterSpacing) }}</span>
                                        </span>
                                    </div>
                                    <small class="muted" style="display:block;margin-bottom:6px">{{ appearance.isWideMonoActive() ? i18n.text('已选等宽中文字体，自动收紧为 -0.9 px 字距与中英文词距', 'Auto -0.9 px spacing for selected wide mono CJK font') : i18n.text('默认双轨比例排版（0.0 px 无需微调）；切换 Maple Mono 等宽字体时将自动优化', 'Dual-track UI & mono typography (0.0 px default); auto-tightens for Maple Mono') }}</small>
                                    <label class="font-size-slider">
                                        <small class="muted">{{ appearanceSpacingRange.min }}</small>
                                        <input type="range" [attr.aria-label]="i18n.text('工作台字间距', 'Letter Spacing')"
                                            [min]="appearanceSpacingRange.min" [max]="appearanceSpacingRange.max" [step]="appearanceSpacingRange.step"
                                            [value]="appearance.letterSpacing" (input)="setAppearanceLetterSpacing($any($event.target).valueAsNumber)">
                                        <small class="muted">+{{ appearanceSpacingRange.max }}</small>
                                    </label>
                                </div>
                            </div>
                        </section>

                        <section class="setting-card" *ngFor="let group of themeGroups; trackBy: trackByKey">
                            <div class="card-head">
                                <strong>{{ group.label }}</strong>
                                <small>{{ i18n.text('点击色卡即时应用', 'Click swatch to apply immediately') }}</small>
                            </div>
                            <div class="theme-grid" role="group" [attr.aria-label]="group.label">
                                <button *ngIf="group.key === 'basic'" type="button" data-theme="tabby"
                                    [attr.aria-pressed]="appearance.theme === 'tabby'" (click)="setAppearance('tabby')">
                                    <span class="theme-swatch" aria-hidden="true"><i style="background:#141d27"></i><i style="background:#38bdf8"></i></span>
                                    <span class="theme-name">{{ i18n.text('跟随 Tabby', 'Follow Tabby') }}</span>
                                </button>
                                <button *ngFor="let palette of group.options; trackBy: trackById" type="button" [attr.data-theme]="palette.id"
                                    [attr.aria-pressed]="appearance.theme === palette.id" [title]="palette.label" (click)="setAppearance(palette.id)">
                                    <span class="theme-swatch" aria-hidden="true">
                                        <i [style.background]="palette.c0"></i>
                                        <i [style.background]="palette.c1"></i>
                                        <i [style.background]="palette.c2"></i>
                                    </span>
                                    <span class="theme-name">{{ palette.label }}</span>
                                </button>
                            </div>
                        </section>
                    </div>

                    <oneai-cli-directories *ngSwitchCase="'directories'"></oneai-cli-directories>

                    <div *ngSwitchCase="'sessions'" class="settings-page">
                        <div>
                            <h3 class="section-title">{{ i18n.text('会话管理', 'Session Management') }}</h3>
                            <p class="section-desc">{{ i18n.text('按所属项目与 AI CLI 筛选管理已移除的会话，随时可重新加回项目树，不会删除本地原始日志。', 'Filter and restore removed sessions by project or AI CLI. Local logs are never deleted.') }}</p>
                        </div>
                        <ng-container *ngIf="workspace.removedSessions.length; else noRemovedSessions">
                            <div class="sessions-filter-bar">
                                <button #remProjTrigger type="button" class="cselect-trigger" [attr.aria-label]="i18n.text('按项目筛选已移除会话', 'Filter removed sessions by project')"
                                    [attr.aria-expanded]="removedMenu === 'project'"
                                    (click)="toggleRemovedMenu('project', remProjTrigger, $event)">
                                    <span>{{ removedProjectFilterLabel }}</span>
                                    <i class="fas fa-angle-down" aria-hidden="true"></i>
                                </button>
                                <button #remCliTrigger type="button" class="cselect-trigger" [attr.aria-label]="i18n.text('按 CLI 筛选已移除会话', 'Filter removed sessions by CLI')"
                                    [attr.aria-expanded]="removedMenu === 'cli'"
                                    (click)="toggleRemovedMenu('cli', remCliTrigger, $event)">
                                    <span>{{ removedCliFilterLabel }}</span>
                                    <i class="fas fa-angle-down" aria-hidden="true"></i>
                                </button>
                                <div class="filter-input-box">
                                    <i class="fas fa-search" aria-hidden="true"></i>
                                    <input type="search" [placeholder]="i18n.text('搜索已移除的会话标题…', 'Search removed session titles…')"
                                        [attr.aria-label]="i18n.text('搜索已移除的会话标题', 'Search removed session titles')"
                                        [value]="removedQuery" (input)="onRemovedQueryInput($any($event.target).value)">
                                </div>
                            </div>

                            <!-- 项目筛选下拉 -->
                            <div *ngIf="removedMenu === 'project'" class="cselect-popover" role="listbox"
                                [style.left.px]="cliEnvLeft" [style.top.px]="cliEnvTop" [style.width.px]="cliEnvWidth"
                                (click)="$event.stopPropagation()">
                                <button type="button" class="cselect-option" [class.selected]="!removedProjectFilter"
                                    (click)="selectRemovedProject('')">
                                    <span>{{ i18n.text('全部项目', 'All projects') }} ({{ workspace.removedSessions.length }})</span>
                                    <span style="color:var(--accent)">{{ !removedProjectFilter ? '✓' : '' }}</span>
                                </button>
                                <button *ngFor="let proj of removedProjectOptions; trackBy: trackById" type="button" class="cselect-option"
                                    [class.selected]="removedProjectFilter === proj.id" (click)="selectRemovedProject(proj.id)">
                                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ proj.name }} · {{ proj.env }} ({{ proj.count }})</span>
                                    <span style="color:var(--accent)">{{ removedProjectFilter === proj.id ? '✓' : '' }}</span>
                                </button>
                            </div>

                            <!-- CLI 筛选下拉 -->
                            <div *ngIf="removedMenu === 'cli'" class="cselect-popover" role="listbox"
                                [style.left.px]="cliEnvLeft" [style.top.px]="cliEnvTop" [style.width.px]="cliEnvWidth"
                                (click)="$event.stopPropagation()">
                                <button type="button" class="cselect-option" [class.selected]="!removedCliFilter"
                                    (click)="selectRemovedCli('')">
                                    <span>{{ i18n.text('全部 CLI', 'All CLIs') }} ({{ workspace.removedSessions.length }})</span>
                                    <span style="color:var(--accent)">{{ !removedCliFilter ? '✓' : '' }}</span>
                                </button>
                                <button *ngFor="let cli of removedCliOptions; trackBy: trackByExecutable" type="button" class="cselect-option"
                                    [class.selected]="removedCliFilter === cli.executable" (click)="selectRemovedCli(cli.executable)">
                                    <span style="display:inline-flex;align-items:center;gap:7px">
                                        <img *ngIf="cli.icon" width="14" height="14" [src]="cli.icon" [class.codex-mark]="cli.executable === 'codex'" alt="">
                                        <span>{{ cli.name }} ({{ cli.count }})</span>
                                    </span>
                                    <span style="color:var(--accent)">{{ removedCliFilter === cli.executable ? '✓' : '' }}</span>
                                </button>
                            </div>

                            <div *ngIf="removedProjectGroups.length; else noMatchedRemovedSessions" class="removed-groups">
                                <div *ngFor="let group of removedProjectGroups; trackBy: trackByProjectId" class="removed-group-card">
                                    <div class="removed-group-head" [class.collapsed]="!isRemovedGroupExpanded(group.projectId)">
                                        <button type="button" class="group-toggle-btn" (click)="toggleRemovedGroup(group.projectId)"
                                            [attr.aria-expanded]="isRemovedGroupExpanded(group.projectId)">
                                            <i class="fas" [class.fa-angle-right]="!isRemovedGroupExpanded(group.projectId)"
                                                [class.fa-angle-down]="isRemovedGroupExpanded(group.projectId)" aria-hidden="true"></i>
                                            <i class="fas fa-folder" style="color:var(--accent)" aria-hidden="true"></i>
                                            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ group.projectName }}</span>
                                            <span class="env-tag" [class.win]="!group.distro">{{ group.distro ? 'WSL · ' + group.distro : 'PS7' }}</span>
                                            <span class="neutral-pill">{{ group.items.length }} {{ i18n.text('条', 'items') }}</span>
                                        </button>
                                        <button type="button" class="ui-btn-subtle" (click)="restoreGroup(group.items)"
                                            [title]="i18n.text('将该组下全部已移除会话重新加回项目树', 'Restore all removed sessions in this project')">{{ i18n.text('全部恢复', 'Restore all') }}</button>
                                    </div>
                                    <div *ngIf="isRemovedGroupExpanded(group.projectId)" class="settings-list" style="border:0;border-radius:0">
                                        <div class="removed-row" *ngFor="let item of group.items; trackBy: trackByRemovedId">
                                            <div class="removed-main">
                                                <img *ngIf="item.cliIcon" width="15" height="15" [src]="item.cliIcon" [class.codex-mark]="item.executable === 'codex'" [alt]="item.cliName">
                                                <span class="removed-title" [title]="item.record.title">{{ item.record.title }}</span>
                                                <span class="cli-tag">{{ item.cliName }}</span>
                                            </div>
                                            <div class="removed-actions">
                                                <time *ngIf="item.removedAtLabel" class="removed-time" [title]="i18n.text('移除于 ', 'Removed ') + item.removedAtLabel">{{ item.removedAtLabel }}</time>
                                                <button type="button" class="ui-btn-primary ui-btn-compact" (click)="restoreSession(item.record)">{{ i18n.text('重新添加', 'Restore') }}</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <ng-template #noMatchedRemovedSessions>
                                <div class="setting-card" style="align-items:center;padding:26px;text-align:center">
                                    <strong>{{ i18n.text('没有匹配的已移除会话', 'No matching removed sessions') }}</strong>
                                    <small class="muted">{{ i18n.text('请尝试切换项目、CLI 筛选条件或清空搜索关键词。', 'Try switching project/CLI filters or clearing the search query.') }}</small>
                                </div>
                            </ng-template>
                        </ng-container>
                        <ng-template #noRemovedSessions>
                            <div class="setting-card" style="align-items:center;padding:28px;text-align:center">
                                <strong>{{ i18n.text('没有已移除的会话', 'No removed sessions') }}</strong>
                                <small class="muted">{{ i18n.text('从侧栏右键移除的会话将按所属项目分组显示在这里。', 'Sessions removed from the sidebar context menu appear here grouped by project.') }}</small>
                            </div>
                        </ng-template>
                    </div>

                    <div *ngSwitchCase="'cli'" class="settings-page">
                        <div>
                            <h3 class="section-title">{{ i18n.text('CLI 可用性检测', 'CLI Availability Check') }}</h3>
                            <p class="section-desc">{{ i18n.text('按所选环境的 PATH 查找命令，项目菜单使用上次检测的结果。', 'Looks up commands on the selected environment PATH. Project menus use the latest cached results.') }}</p>
                        </div>
                        <div class="actions">
                            <div style="display:flex;align-items:center;gap:10px">
                                <button #cliEnvTrigger type="button" class="cselect-trigger" style="width:210px"
                                    [attr.aria-label]="i18n.text('CLI 检测环境', 'CLI check environment')" [attr.aria-expanded]="cliEnvMenuOpen"
                                    (click)="toggleCliEnvMenu(cliEnvTrigger, $event)">
                                    <span>{{ cliDistro ? 'WSL · ' + cliDistro : 'PowerShell 7' }}</span>
                                    <i class="fas fa-angle-down" aria-hidden="true"></i>
                                </button>
                                <span *ngIf="detectedCli as found" class="neutral-pill">
                                    {{ i18n.text('已检测到 ', 'Detected ') }}{{ found.length }} / {{ cliList.length }}
                                </span>
                            </div>
                            <button type="button" class="ui-btn-primary" [disabled]="checking" (click)="checkCli(true)">
                                {{ checking ? i18n.text('检测中…', 'Checking…') : i18n.text('重新检测', 'Recheck') }}
                            </button>
                        </div>
                        <div *ngIf="cliEnvMenuOpen" class="cselect-popover" role="listbox"
                            [style.left.px]="cliEnvLeft" [style.top.px]="cliEnvTop" [style.width.px]="cliEnvWidth"
                            (click)="$event.stopPropagation()">
                            <button type="button" class="cselect-option" [class.selected]="!cliDistro" (click)="selectCliEnvironment('')">
                                <span>PowerShell 7</span>
                                <span style="color:var(--accent)">{{ !cliDistro ? '✓' : '' }}</span>
                            </button>
                            <button *ngFor="let distro of distros; trackBy: trackByValue" type="button" class="cselect-option"
                                [class.selected]="distro === cliDistro" (click)="selectCliEnvironment(distro)">
                                <span>WSL · {{ distro }}</span>
                                <span style="color:var(--accent)">{{ distro === cliDistro ? '✓' : '' }}</span>
                            </button>
                        </div>
                        <div class="cli-grid">
                            <div class="cli-card" *ngFor="let cli of cliList; trackBy: trackByExecutable">
                                <span class="cli-identity">
                                    <img width="16" height="16" [src]="cli.source" [class.codex-mark]="cli.executable === 'codex'" alt="">
                                    <span><strong>{{ cli.name }}</strong><code>{{ cli.executable }}</code></span>
                                </span>
                                <span *ngIf="detectedCli as found" class="state-badge"
                                    [class.detected]="found.includes(cli.executable)" [class.undetected]="!found.includes(cli.executable)">
                                    {{ found.includes(cli.executable) ? i18n.text('已检测到', 'Detected') : i18n.text('未检测到', 'Not found') }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div *ngSwitchCase="'shortcuts'" class="settings-page">
                        <div class="shortcut-head">
                            <div>
                                <h3 class="section-title">{{ i18n.text('工作台快捷键', 'Workbench Hotkeys') }}</h3>
                                <p class="section-desc">{{ i18n.text('点击右侧按键框可直接录入组合键（自动避开 Tabby 默认键位并同步到 Tabby 设置）。', 'Click a shortcut button to record keys directly. Synced automatically with Tabby Settings.') }}</p>
                            </div>
                            <button type="button" class="ui-btn-primary" [disabled]="savingHotkeys" (click)="restoreDefaultHotkeys()">
                                {{ i18n.text('恢复推荐快捷键', 'Restore Recommended') }}
                            </button>
                        </div>
                        <div class="settings-list">
                            <div class="shortcut-row" *ngFor="let shortcut of shortcuts; trackBy: trackById">
                                <div class="shortcut-info">
                                    <span style="font-weight:600">{{ i18n.hotkeyName(shortcut.id, shortcut.name) }}</span>
                                    <small class="muted">{{ i18n.text('推荐：', 'Recommended: ') }}{{ shortcut.defaultKeys[0] }}</small>
                                </div>
                                <div class="shortcut-controls">
                                    <button type="button" class="hotkey-recorder"
                                        [class.recording]="recordingHotkeyId === shortcut.id"
                                        [class.unbound]="recordingHotkeyId !== shortcut.id && isShortcutUnbound(shortcut.id)"
                                        [disabled]="savingHotkeys"
                                        [title]="recordingHotkeyId === shortcut.id ? i18n.text('按组合键绑定，Esc 取消', 'Press shortcut keys, Esc to cancel') : i18n.text('点击录制快捷键', 'Click to record shortcut')"
                                        (click)="toggleHotkeyRecording(shortcut.id, $event)">
                                        <span *ngIf="recordingHotkeyId === shortcut.id">{{ i18n.text('请按下组合键… (Esc 取消)', 'Press shortcut… (Esc to cancel)') }}</span>
                                        <span *ngIf="recordingHotkeyId !== shortcut.id">{{ shortcutKeys(shortcut.id) }}</span>
                                    </button>
                                    <button *ngIf="!isShortcutUnbound(shortcut.id)" type="button" class="hotkey-clear"
                                        [disabled]="savingHotkeys"
                                        [title]="i18n.text('清除快捷键', 'Clear shortcut')"
                                        [attr.aria-label]="i18n.text('清除快捷键', 'Clear shortcut')"
                                        (click)="clearShortcut(shortcut.id, $event)">
                                        <i class="fas fa-times" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p *ngIf="hotkeyNotice" class="shortcut-status" role="status">{{ hotkeyNotice }}</p>
                        <p *ngIf="hotkeyWarning" class="shortcut-warning" role="alert">{{ hotkeyWarning }}</p>
                    </div>
                </ng-container>
            </div>
            <p *ngIf="error" class="error" role="alert">{{ error }}</p>
        </dialog>
        <dialog #confirmCloseDialog class="confirm-close" [attr.aria-label]="i18n.text('确认关闭', 'Confirm Close')"
            (cancel)="onConfirmCloseCancel($event)" (close)="finishConfirmClose(false)" (click)="dismissConfirmCloseBackdrop($event)">
            <header>
                <div class="header-left">
                    <span class="header-icon confirm-warn" aria-hidden="true"><i class="fas fa-exclamation-triangle"></i></span>
                    <h2>{{ i18n.text('仍有会话正在运行', 'Active Sessions Running') }}</h2>
                </div>
                <button type="button" class="close" [attr.aria-label]="i18n.text('关闭', 'Close')" (click)="finishConfirmClose(false)">×</button>
            </header>
            <div class="confirm-body">
                <p>{{ confirmCloseMessage }}</p>
                <div class="confirm-list" *ngIf="confirmCloseItems.length">
                    <div *ngFor="let item of confirmCloseItems; trackBy: trackById" class="confirm-item">
                        <div class="confirm-item-main">
                            <img *ngIf="item.cliIcon" width="16" height="16" [src]="item.cliIcon" [alt]="item.cliName">
                            <div class="confirm-item-text">
                                <strong>{{ item.title }}</strong>
                                <small *ngIf="item.projectLabel">{{ item.cliName }} · {{ item.projectLabel }}</small>
                            </div>
                        </div>
                        <span class="confirm-pill" [ngClass]="item.status">{{ item.statusLabel }}</span>
                    </div>
                </div>
            </div>
            <footer class="confirm-actions">
                <button type="button" class="confirm-keep" autofocus (click)="finishConfirmClose(false)">{{ i18n.text('取消（继续运行）', 'Keep Running') }}</button>
                <button type="button" class="confirm-danger" (click)="finishConfirmClose(true)">{{ i18n.text('仍要关闭', 'Close Anyway') }}</button>
            </footer>
        </dialog>
    `,
})
export class WorkbenchOverlay implements OnInit, OnDestroy, DoCheck {
    @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
    @ViewChild('confirmCloseDialog', { static: true }) confirmCloseDialog!: ElementRef<HTMLDialogElement>;
    page: 'history' | 'usage' | 'settings' | 'search' = 'history';
    section: 'appearance' | 'directories' | 'cli' | 'sessions' | 'shortcuts' = 'appearance';
    session?: Task | HistoryEntry;
    visible = false;
    checking = false;
    detectedCli?: readonly string[];
    error = '';
    distros: string[] = [];
    cliDistro?: string;
    cliEnvMenuOpen = false;
    cliEnvLeft = 0;
    cliEnvTop = 0;
    cliEnvWidth = 210;
    fontFamilies: string[] = [];
    fontsLoading = false;
    fontQuery = '';
    fontDraft = '';
    fontEditing = false;
    fontHighlight = -2;
    matchingFonts: string[] = [];
    fontMenuOpen = false;
    fontMenuLeft = 0;
    fontMenuTop: number | null = 0;
    fontMenuBottom: string | null = 'auto';
    fontMenuWidth = 260;
    fontMenuMaxHeight = 200;

    // 会话管理筛选状态（缓存结果避免 Angular CD 循环重算与重建 DOM）
    removedProjectFilter = '';
    removedCliFilter = '';
    removedQuery = '';
    removedMenu: 'project' | 'cli' | '' = '';
    removedProjectOptions: RemovedProjectOption[] = [];
    removedCliOptions: RemovedCliOption[] = [];
    removedProjectGroups: RemovedProjectGroup[] = [];
    removedProjectFilterLabel = '';
    removedCliFilterLabel = '';
    private readonly manualRemovedGroupState = new Map<string, boolean>();
    private removedTreeVersion = -1;
    private removedLang = '';

    // 项目历史会话查找状态
    searchProject?: Project;
    searchCliFilter = '';
    searchQuery = '';
    searchLoading = false;
    searchOpening = false;
    searchAllItems: SearchSessionItem[] = [];
    searchCliCounts: SearchCliCount[] = [];
    filteredSearchItems: SearchSessionItem[] = [];
    private searchLoadId = 0;
    private searchStartTimer?: ReturnType<typeof setTimeout>;

    readonly appearanceSizeRange = interfaceFontSizeRange;
    readonly defaultSize = defaultInterfaceFontSize;
    readonly appearanceSpacingRange = interfaceLetterSpacingRange;
    readonly shortcuts = workbenchHotkeys;
    readonly cliList = supportedCli;
    readonly icons = { history: 'fa-history', usage: 'fa-chart-bar', settings: 'fa-cog', search: 'fa-search' };
    themeGroups: { key: string; label: string; options: { id: AppearanceTheme; label: string; c0: string; c1: string; c2: string }[] }[] = [];
    sections: { key: 'appearance' | 'directories' | 'cli' | 'sessions' | 'shortcuts'; label: string; icon: string }[] = [];

    readonly trackByKey = (_: number, item: { key: string }) => item.key;
    readonly trackById = (_: number, item: { id: string }) => item.id;
    readonly trackByExecutable = (_: number, item: { executable: string }) => item.executable;
    readonly trackByProjectId = (_: number, item: { projectId: string }) => item.projectId;
    readonly trackByRemovedId = (_: number, item: RemovedMetaItem) => item.record.id;
    readonly trackByValue = (_: number, value: string) => value;

    recordingHotkeyId = '';
    savingHotkeys = false;
    hotkeyNotice = '';
    hotkeyWarning = '';
    private hotkeysDisabled = false;

    private subscription?: Subscription;
    private langSubscription?: Subscription;
    private checkingDistro?: string;
    confirmCloseItems: { id: string; title: string; cliName: string; cliIcon: string; projectLabel: string; status: string; statusLabel: string }[] = [];
    private confirmCloseResolve?: (allow: boolean) => void;

    constructor(
        @Inject(WorkbenchNavigation) private readonly navigation: WorkbenchNavigation,
        @Inject(WorkspaceService) readonly workspace: WorkspaceService,
        @Inject(ConfigService) readonly config: HostConfig,
        @Inject(WorkbenchAppearance) readonly appearance: WorkbenchAppearance,
        @Inject(ChangeDetectorRef) private readonly cdr: ChangeDetectorRef,
        @Inject(WorkbenchI18n) readonly i18n: WorkbenchI18n,
        @Inject(HotkeysService) private readonly hotkeys: { disable?(): void; enable?(): void },
        @Inject(NgZone) private readonly zone: NgZone,
    ) {
        this.rebuildStaticLabels();
    }

    get dialogTitle(): string {
        if (this.page === 'search') {
            const base = this.i18n.text('查找历史会话', 'Find Session History');
            return this.searchProject ? `${base} · ${this.searchProject.name}` : base;
        }
        const titles = {
            history: this.i18n.text('历史提示词', 'Prompt History'),
            usage: this.i18n.text('用量统计', 'Usage Analytics'),
            settings: this.i18n.text('工作台设置', 'Workbench Settings'),
        };
        return titles[this.page];
    }

    private rebuildStaticLabels(): void {
        this.themeGroups = [
            { key: 'basic', label: this.i18n.text('基础主题', 'Base Themes') },
            { key: 'eyecare', label: this.i18n.text('护眼配色', 'Eye-Care Themes') },
            { key: 'editor', label: this.i18n.text('编辑器配色', 'Editor Themes') },
        ].map(group => ({
            ...group,
            options: palettes.filter(palette => palette.group === group.key).map(({ id, label, colors }) => ({
                id, label: this.i18n.themeLabel(id, label), c0: colors[0], c1: colors[15], c2: colors[18],
            })),
        }));
        this.sections = [
            { key: 'appearance', label: this.i18n.text('外观', 'Appearance'), icon: 'fa-palette' },
            { key: 'directories', label: this.i18n.text('CLI 环境与目录', 'CLI Environments'), icon: 'fa-folder-open' },
            { key: 'cli', label: this.i18n.text('CLI 检测', 'CLI Detection'), icon: 'fa-code' },
            { key: 'sessions', label: this.i18n.text('会话管理', 'Sessions'), icon: 'fa-history' },
            { key: 'shortcuts', label: this.i18n.text('快捷键', 'Hotkeys'), icon: 'fa-keyboard' },
        ];
    }

    setLanguage(lang: WorkbenchLanguage): void {
        this.error = '';
        this.i18n.setLanguage(lang);
    }

    @HostListener('document:click')
    closeCliEnvMenu(): void {
        this.cliEnvMenuOpen = false;
        this.removedMenu = '';
        this.fontMenuOpen = false;
        this.fontEditing = false;
        this.stopHotkeyRecording();
    }

    @HostListener('window:keydown', ['$event'])
    handleHotkeyRecordKey(event: KeyboardEvent): void {
        const targetId = this.recordingHotkeyId;
        if (!targetId) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
            this.stopHotkeyRecording();
            return;
        }
        const stroke = keyboardEventToTabbyStroke(event);
        if (!stroke) return;
        const conflict = this.findHotkeyConflict(stroke, targetId);
        if (conflict) {
            this.hotkeyNotice = '';
            this.hotkeyWarning = this.i18n.text(
                `快捷键 ${stroke} 已被「${conflict}」占用，请按下其它组合键。`,
                `Shortcut ${stroke} is already used by "${conflict}". Press a different combination.`,
            );
            this.cdr.detectChanges();
            return;
        }
        this.stopHotkeyRecording();
        void this.saveHotkeyBinding(targetId, [stroke], this.i18n.text(`已绑定 ${stroke}`, `Bound ${stroke}`));
    }

    ngOnInit(): void {
        this.workspace.registerCloseConfirm(tasks => this.promptCloseConfirm(tasks));
        this.langSubscription = this.i18n.changed$.subscribe(() => {
            this.rebuildStaticLabels();
            this.rebuildRemovedView();
            this.rebuildSearchView();
            this.cdr.markForCheck();
        });
        this.subscription = this.navigation.overlay$.subscribe(({ page, session, project, cli }) => {
            if (this.searchStartTimer) {
                clearTimeout(this.searchStartTimer);
                this.searchStartTimer = undefined;
            }
            this.searchLoadId++;
            this.page = page;
            this.session = session;
            this.visible = true;
            this.error = '';
            this.cliEnvMenuOpen = false;
            this.removedMenu = '';
            this.fontMenuOpen = false;
            this.fontEditing = false;
            if (page === 'settings') {
                this.selectSection(this.section);
            } else if (page === 'search') {
                this.searchProject = project ?? this.workspace.projects[0];
                this.searchCliFilter = cli ?? '';
                this.searchQuery = '';
                this.searchOpening = false;
                this.searchLoading = true;
                if (this.searchProject) {
                    this.populateSearchItems(this.searchProject, this.workspace.cachedProjectSessions(this.searchProject));
                } else {
                    this.searchAllItems = [];
                    this.rebuildSearchView();
                    this.searchLoading = false;
                }
            }
            if (this.dialog.nativeElement.isConnected && !this.dialog.nativeElement.open) {
                try { this.dialog.nativeElement.showModal(); } catch {}
            }
            this.cdr.detectChanges();
            if (page === 'search' && this.searchProject) {
                const loadId = this.searchLoadId;
                this.searchStartTimer = setTimeout(() => {
                    this.searchStartTimer = undefined;
                    if (this.visible && this.page === 'search' && loadId === this.searchLoadId) {
                        void this.loadProjectSearch(loadId);
                    }
                }, 0);
            }
        });
    }

    ngDoCheck(): void {
        if (this.visible && this.page === 'settings' && this.section === 'sessions') {
            if (this.removedTreeVersion !== this.workspace.treeVersion || this.removedLang !== this.i18n.lang) {
                this.rebuildRemovedView();
            }
        }
    }

    ngOnDestroy(): void {
        this.workspace.registerCloseConfirm(undefined);
        this.finishConfirmClose(true);
        this.stopHotkeyRecording();
        if (this.searchStartTimer) clearTimeout(this.searchStartTimer);
        this.subscription?.unsubscribe();
        this.langSubscription?.unsubscribe();
    }

    get confirmCloseMessage(): string {
        const count = this.confirmCloseItems.length;
        if (count <= 1) {
            return this.i18n.text(
                '当前有会话正在运行或等待处理，直接关闭窗口将会中断该任务。确定要关闭吗？',
                'A session is currently running or waiting for action. Closing now will interrupt it. Close anyway?',
            );
        }
        return this.i18n.text(
            `当前有 ${count} 个会话正在运行或等待处理，直接关闭窗口将会中断这些任务。确定要关闭吗？`,
            `${count} sessions are currently running or waiting for action. Closing now will interrupt them. Close anyway?`,
        );
    }

    private promptCloseConfirm(tasks: Task[]): Promise<boolean> {
        const dialog = this.confirmCloseDialog?.nativeElement;
        if (!dialog || !dialog.isConnected) return Promise.resolve(true);
        if (this.confirmCloseResolve) this.finishConfirmClose(false);
        return new Promise<boolean>(resolve => {
            this.zone.run(() => {
                this.confirmCloseResolve = resolve;
                this.confirmCloseItems = tasks.map(task => {
                    const brand = cliBrand(task.executable);
                    const proj = this.workspace.projectFor(task);
                    return {
                        id: task.id,
                        title: task.name,
                        cliName: brand?.name ?? task.executable,
                        cliIcon: brand?.source ?? '',
                        projectLabel: proj ? `${proj.name} · ${proj.distro ? `WSL · ${proj.distro}` : 'PS7'}` : '',
                        status: statusDisplay(task),
                        statusLabel: taskStatusLabel(task),
                    };
                });
                this.cdr.detectChanges();
                try {
                    if (!dialog.open) dialog.showModal();
                    dialog.querySelector<HTMLButtonElement>('.confirm-keep')?.focus();
                } catch {
                    this.finishConfirmClose(true);
                }
            });
        });
    }

    onConfirmCloseCancel(event: Event): void {
        event.preventDefault();
        this.finishConfirmClose(false);
    }

    dismissConfirmCloseBackdrop(event: MouseEvent): void {
        const dialog = this.confirmCloseDialog.nativeElement;
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            this.finishConfirmClose(false);
        }
    }

    finishConfirmClose(allow: boolean): void {
        const resolve = this.confirmCloseResolve;
        this.confirmCloseResolve = undefined;
        this.confirmCloseItems = [];
        const dialog = this.confirmCloseDialog?.nativeElement;
        if (dialog?.isConnected && dialog.open) {
            try { dialog.close(); } catch {}
        }
        try { this.cdr.detectChanges(); } catch {}
        resolve?.(allow);
    }

    closeDialog(): void {
        this.stopHotkeyRecording();
        if (this.searchStartTimer) {
            clearTimeout(this.searchStartTimer);
            this.searchStartTimer = undefined;
        }
        this.searchLoadId++;
        this.searchLoading = false;
        this.searchOpening = false;
        this.visible = false;
        if (this.dialog.nativeElement.open) this.dialog.nativeElement.close();
        this.cdr.detectChanges();
    }

    onDialogCancel(event: Event): void {
        if (this.recordingHotkeyId) {
            event.preventDefault();
            this.stopHotkeyRecording();
        }
    }

    onClose(): void {
        if (!this.dialog.nativeElement.open) {
            this.stopHotkeyRecording();
            if (this.searchStartTimer) {
                clearTimeout(this.searchStartTimer);
                this.searchStartTimer = undefined;
            }
            this.searchLoadId++;
            this.searchLoading = false;
            this.visible = false;
            this.cdr.detectChanges();
        }
    }

    dismissBackdrop(event: MouseEvent): void {
        const dialog = this.dialog.nativeElement;
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) this.closeDialog();
    }

    selectSection(section: typeof this.section): void {
        this.stopHotkeyRecording();
        this.section = section;
        this.error = '';
        this.hotkeyNotice = '';
        this.hotkeyWarning = '';
        this.cliEnvMenuOpen = false;
        this.removedMenu = '';
        this.fontMenuOpen = false;
        this.fontEditing = false;
        if (section === 'sessions') {
            this.manualRemovedGroupState.clear();
            this.rebuildRemovedView();
        }
        if (section === 'cli') {
            const existing = [...new Set(this.workspace.projects.map(item => item.distro).filter((item): item is string => Boolean(item)))];
            this.distros = existing;
            void distributions().then(items => {
                this.distros = [...new Set([...items, ...existing])];
                this.cdr.detectChanges();
            });
        }
        if (section === 'appearance') this.ensureFontsLoaded();
        if (section === 'cli') void this.checkCli();
    }

    // ---- 会话管理（已移除会话）计算与操作 ----
    private resolveRemovedMeta(record: RemovedSession): RemovedMetaItem {
        const proj = this.workspace.projectById(record.projectId);
        const projectName = proj?.name ?? record.projectName ?? this.i18n.text('未知项目', 'Unknown project');
        const distro = proj ? proj.distro : record.distro;
        const executable = this.workspace.removedSessionCli(record);
        const brand = cliBrand(executable);
        return {
            record,
            projectId: record.projectId,
            projectName,
            distro,
            env: distro ? `WSL · ${distro}` : 'PS7',
            executable,
            cliName: brand?.name ?? executable,
            cliIcon: brand?.source ?? '',
            removedAtLabel: formatTimestamp(record.removedAt),
        };
    }

    private rebuildRemovedView(): void {
        this.removedTreeVersion = this.workspace.treeVersion;
        this.removedLang = this.i18n.lang;
        const projMap = new Map<string, RemovedProjectOption>();
        const cliMap = new Map<string, RemovedCliOption>();
        const query = this.removedQuery.trim().toLowerCase();
        const groups = new Map<string, RemovedProjectGroup>();
        const removed = this.workspace.removedSessions;

        for (const raw of removed) {
            const meta = this.resolveRemovedMeta(raw);
            const curProj = projMap.get(meta.projectId);
            if (curProj) {
                curProj.count++;
                curProj.latest = Math.max(curProj.latest, raw.removedAt);
            } else {
                projMap.set(meta.projectId, { id: meta.projectId, name: meta.projectName, env: meta.env, count: 1, latest: raw.removedAt });
            }
            const curCli = cliMap.get(meta.executable);
            if (curCli) curCli.count++;
            else cliMap.set(meta.executable, { executable: meta.executable, name: meta.cliName, icon: meta.cliIcon, count: 1 });

            if (this.removedProjectFilter && meta.projectId !== this.removedProjectFilter) continue;
            if (this.removedCliFilter && meta.executable !== this.removedCliFilter) continue;
            if (query && !meta.record.title.toLowerCase().includes(query) && !meta.projectName.toLowerCase().includes(query) && !meta.cliName.toLowerCase().includes(query)) continue;
            let group = groups.get(meta.projectId);
            if (!group) {
                group = { projectId: meta.projectId, projectName: meta.projectName, distro: meta.distro, latestAt: 0, items: [] };
                groups.set(meta.projectId, group);
            }
            group.items.push(meta);
            group.latestAt = Math.max(group.latestAt, raw.removedAt);
        }
        for (const group of groups.values()) {
            group.items.sort((a, b) => b.record.removedAt - a.record.removedAt);
        }
        this.removedProjectOptions = [...projMap.values()].sort((a, b) => b.latest - a.latest);
        this.removedCliOptions = [...cliMap.values()].sort((a, b) => b.count - a.count);
        this.removedProjectGroups = [...groups.values()].sort((a, b) => b.latestAt - a.latestAt);

        if (!this.removedProjectFilter) {
            this.removedProjectFilterLabel = `${this.i18n.text('全部项目', 'All projects')} (${removed.length})`;
        } else {
            const foundProj = this.removedProjectOptions.find(p => p.id === this.removedProjectFilter);
            this.removedProjectFilterLabel = foundProj ? `${foundProj.name} (${foundProj.count})` : this.i18n.text('全部项目', 'All projects');
        }
        if (!this.removedCliFilter) {
            this.removedCliFilterLabel = this.i18n.text('全部 CLI', 'All CLIs');
        } else {
            const foundCli = this.removedCliOptions.find(c => c.executable === this.removedCliFilter);
            this.removedCliFilterLabel = foundCli ? `${foundCli.name} (${foundCli.count})` : this.i18n.text('全部 CLI', 'All CLIs');
        }
    }

    onRemovedQueryInput(value: string): void {
        this.removedQuery = value;
        this.manualRemovedGroupState.clear();
        this.rebuildRemovedView();
    }

    toggleRemovedMenu(type: 'project' | 'cli', trigger: HTMLElement, event: MouseEvent): void {
        event.stopPropagation();
        if (this.removedMenu === type) {
            this.removedMenu = '';
            return;
        }
        const rect = trigger.getBoundingClientRect();
        this.cliEnvWidth = Math.max(rect.width, 210);
        this.cliEnvLeft = Math.min(Math.max(8, rect.left), window.innerWidth - this.cliEnvWidth - 8);
        this.cliEnvTop = rect.bottom + 5;
        this.removedMenu = type;
    }

    selectRemovedProject(projectId: string): void {
        this.removedMenu = '';
        this.removedProjectFilter = projectId;
        this.manualRemovedGroupState.clear();
        this.rebuildRemovedView();
    }

    selectRemovedCli(executable: string): void {
        this.removedMenu = '';
        this.removedCliFilter = executable;
        this.manualRemovedGroupState.clear();
        this.rebuildRemovedView();
    }

    isRemovedGroupExpanded(projectId: string): boolean {
        const manual = this.manualRemovedGroupState.get(projectId);
        if (manual !== undefined) return manual;
        return this.removedProjectGroups.length === 1
            || Boolean(this.removedQuery.trim() || this.removedProjectFilter || this.removedCliFilter);
    }

    toggleRemovedGroup(projectId: string): void {
        this.manualRemovedGroupState.set(projectId, !this.isRemovedGroupExpanded(projectId));
    }

    restoreGroup(items: { record: RemovedSession }[]): void {
        this.error = '';
        try {
            this.workspace.restoreRemovedSessions(items.map(i => i.record));
            this.rebuildRemovedView();
        } catch {
            this.error = this.i18n.text('无法重新添加该项目下的会话。', 'Unable to restore sessions for this project.');
        }
    }

    // ---- 查找项目历史会话计算与操作 ----
    onSearchQueryInput(value: string): void {
        this.searchQuery = value;
        this.rebuildSearchView();
    }

    setSearchCliFilter(executable: string): void {
        this.searchCliFilter = executable;
        this.rebuildSearchView();
    }

    private rebuildSearchView(): void {
        const countMap = new Map<string, SearchCliCount>();
        const query = this.searchQuery.trim().toLowerCase();
        const filtered: SearchSessionItem[] = [];
        for (const item of this.searchAllItems) {
            const cur = countMap.get(item.executable);
            if (cur) cur.count++;
            else countMap.set(item.executable, { executable: item.executable, name: item.cliName, icon: item.cliIcon, count: 1 });
            if (this.searchCliFilter && item.executable !== this.searchCliFilter) continue;
            if (query && !item.title.toLowerCase().includes(query) && !item.cliName.toLowerCase().includes(query)) continue;
            filtered.push(item);
        }
        this.searchCliCounts = [...countMap.values()].sort((a, b) => b.count - a.count);
        this.filteredSearchItems = filtered;
    }

    private populateSearchItems(project: Project, entries: HistoryEntry[]): void {
        const tasks = this.workspace.tasksFor(project);
        const items: SearchSessionItem[] = [];
        const boundTaskIds = new Set<string>();
        for (const task of tasks) {
            const brand = cliBrand(task.executable);
            const exec = brand?.executable ?? task.executable;
            boundTaskIds.add(task.id);
            const time = this.workspace.sessionUpdatedAt(project, task);
            items.push({
                id: task.id,
                title: task.name,
                executable: exec,
                cliName: brand?.name ?? task.executable,
                cliIcon: brand?.source ?? '',
                time,
                timeLabel: formatTimestamp(time),
                status: statusDisplay(task),
                statusLabel: taskStatusLabel(task),
                task,
            });
        }
        for (const entry of entries) {
            const existingTask = this.workspace.historyTask(entry, project.id);
            if (existingTask && boundTaskIds.has(existingTask.id)) continue;
            const exec = entry.cli?.executable ?? 'codex';
            const brand = cliBrand(exec);
            items.push({
                id: `${entry.scope.key}:${entry.id}`,
                title: entry.title,
                executable: exec,
                cliName: brand?.name ?? exec,
                cliIcon: brand?.source ?? '',
                time: entry.updatedAt,
                timeLabel: formatTimestamp(entry.updatedAt),
                status: 'stopped',
                statusLabel: 'Exited',
                entry,
            });
        }
        items.sort((a, b) => b.time - a.time);
        this.searchAllItems = items;
        this.rebuildSearchView();
    }

    async loadProjectSearch(targetLoadId?: number): Promise<void> {
        const project = this.searchProject;
        if (!project) return;
        const loadId = targetLoadId ?? ++this.searchLoadId;
        this.searchLoading = true;
        this.error = '';
        this.cdr.detectChanges();
        try {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), 15000);
            });
            const rawEntries = await Promise.race([this.workspace.projectSessions(project, 30), timeout])
                .finally(() => { if (timer) clearTimeout(timer); });
            if (loadId !== this.searchLoadId) return;
            const entries = rawEntries.filter(entry => !this.workspace.isHistoryRemoved(entry));
            this.populateSearchItems(project, entries);
            if (this.searchCliFilter && !this.searchAllItems.some(item => item.executable === this.searchCliFilter)) {
                this.searchCliFilter = '';
                this.rebuildSearchView();
            }
        } catch (err) {
            if (loadId === this.searchLoadId && !this.searchAllItems.length) {
                this.error = err instanceof Error && err.message === 'timeout'
                    ? this.i18n.text('扫描项目历史会话超时，请点击刷新重试。', 'Scanning project session history timed out. Click Refresh to retry.')
                    : this.i18n.text('无法加载该项目的历史会话。', 'Unable to load session history for this project.');
            }
        } finally {
            if (loadId === this.searchLoadId) {
                this.searchLoading = false;
                this.cdr.detectChanges();
            }
        }
    }

    async activateFromSearch(item: SearchSessionItem): Promise<void> {
        if (this.searchOpening) return;
        this.searchOpening = true;
        this.error = '';
        this.cdr.detectChanges();
        try {
            if (item.task) {
                if (item.task.status === 'stopped' || item.task.status === 'failed') await this.workspace.start(item.task);
                else this.workspace.select(item.task);
            } else if (item.entry) {
                await this.workspace.restoreHistory(item.entry);
            }
            this.closeDialog();
        } catch {
            this.error = this.i18n.text('无法恢复该会话，请检查原目录和运行环境。', 'Unable to restore this session. Check the directory and runtime environment.');
        } finally {
            this.searchOpening = false;
            this.cdr.detectChanges();
        }
    }

    openFromSearch(target: 'history' | 'usage', item: SearchSessionItem): void {
        const session = item.task ?? item.entry;
        if (!session) return;
        this.navigation.open(target, session);
    }

    setAppearance(theme: AppearanceTheme): void {
        this.error = '';
        try { this.appearance.setTheme(theme); }
        catch { this.error = this.i18n.text('无法保存工作台主题。', 'Unable to save workbench theme.'); }
    }

    get fontInputValue(): string {
        return this.fontEditing ? this.fontDraft : this.appearance.fontFamily;
    }

    get showDefaultFontOption(): boolean {
        return !this.fontEditing || !this.fontQuery.trim();
    }

    private rebuildFontView(): void {
        const query = this.fontQuery.trim().toLocaleLowerCase();
        this.matchingFonts = query ? this.fontFamilies.filter(font => font.toLocaleLowerCase().includes(query)) : this.fontFamilies;
    }

    private placeFontMenu(anchor: HTMLElement): void {
        const bounds = anchor.getBoundingClientRect();
        const belowSpace = window.innerHeight - bounds.bottom - 12;
        const aboveSpace = bounds.top - 12;
        const above = belowSpace < 160 && aboveSpace > belowSpace;
        this.fontMenuWidth = Math.max(bounds.width, 240);
        this.fontMenuLeft = Math.min(bounds.left, Math.max(12, window.innerWidth - this.fontMenuWidth - 12));
        this.fontMenuMaxHeight = Math.min(200, Math.max(110, above ? aboveSpace : belowSpace));
        if (above) {
            this.fontMenuTop = null;
            this.fontMenuBottom = `${window.innerHeight - bounds.top + 4}px`;
        } else {
            this.fontMenuTop = bounds.bottom + 4;
            this.fontMenuBottom = 'auto';
        }
    }

    private ensureFontsLoaded(): void {
        if (this.fontFamilies.length || this.fontsLoading) return;
        this.fontsLoading = true;
        void this.workspace.platform.listFonts().then(fonts => {
            this.fontFamilies = [...new Set(fonts.filter(Boolean))].sort((left, right) => left.localeCompare(right));
            this.fontsLoading = false;
            this.rebuildFontView();
            if (!this.fontEditing && this.appearance.fontFamily) {
                this.fontHighlight = this.selectedFontIndex();
            }
            this.cdr.detectChanges();
            if (this.fontMenuOpen) this.scrollFontOptionIntoView(!this.fontEditing);
        }).catch(() => {
            this.fontsLoading = false;
            this.cdr.detectChanges();
        });
    }

    isFontSelected(font: string): boolean {
        const current = this.appearance.fontFamily.trim().toLocaleLowerCase();
        return Boolean(current) && font.toLocaleLowerCase() === current;
    }

    private selectedFontIndex(): number {
        const current = this.appearance.fontFamily.trim().toLocaleLowerCase();
        if (!current) return -1;
        return this.matchingFonts.findIndex(font => font.toLocaleLowerCase() === current);
    }

    private scrollFontOptionIntoView(preferSelected: boolean): void {
        requestAnimationFrame(() => {
            const menu = this.dialog.nativeElement.querySelector<HTMLElement>('#oneai-font-menu .font-options');
            if (!menu) return;
            const target = preferSelected
                ? (menu.querySelector<HTMLElement>('.font-option[aria-pressed="true"]') ?? menu.querySelector<HTMLElement>('.font-option.highlighted'))
                : (menu.querySelector<HTMLElement>('.font-option.highlighted') ?? menu.querySelector<HTMLElement>('.font-option[aria-pressed="true"]'));
            if (!target) return;
            const targetTop = target.getBoundingClientRect().top - menu.getBoundingClientRect().top + menu.scrollTop;
            if (preferSelected) {
                menu.scrollTop = Math.max(0, targetTop - Math.round((menu.clientHeight - target.offsetHeight) / 2));
                return;
            }
            const targetBottom = targetTop + target.offsetHeight;
            if (targetTop < menu.scrollTop) menu.scrollTop = targetTop;
            else if (targetBottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = targetBottom - menu.clientHeight;
        });
    }

    onFontFocus(anchor: HTMLElement): void {
        if (!this.fontMenuOpen) this.openFontDropdown(anchor);
    }

    onFontClick(anchor: HTMLElement): void {
        if (!this.fontMenuOpen) this.openFontDropdown(anchor);
    }

    openFontDropdown(anchor: HTMLElement): void {
        this.ensureFontsLoaded();
        this.fontEditing = false;
        this.fontQuery = '';
        this.rebuildFontView();
        this.fontHighlight = this.selectedFontIndex();
        this.placeFontMenu(anchor);
        this.fontMenuOpen = true;
        this.cdr.detectChanges();
        this.scrollFontOptionIntoView(true);
    }

    toggleFontDropdown(anchor: HTMLElement, input: HTMLInputElement): void {
        if (this.fontMenuOpen) {
            this.fontMenuOpen = false;
            this.fontEditing = false;
            return;
        }
        input.focus();
        this.openFontDropdown(anchor);
    }

    onFontInput(value: string, anchor: HTMLElement): void {
        this.fontEditing = true;
        this.fontDraft = value;
        this.fontQuery = value;
        this.rebuildFontView();
        this.fontHighlight = this.matchingFonts.length ? 0 : (this.showDefaultFontOption ? -1 : -2);
        this.placeFontMenu(anchor);
        this.fontMenuOpen = true;
    }

    onFontKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
        const minIdx = this.showDefaultFontOption ? -1 : 0;
        const maxIdx = this.matchingFonts.length - 1;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!this.fontMenuOpen) this.openFontDropdown(input.parentElement!);
            if (maxIdx >= minIdx) {
                this.fontHighlight = this.fontHighlight < minIdx || this.fontHighlight >= maxIdx ? minIdx : this.fontHighlight + 1;
                this.scrollFontOptionIntoView(false);
            }
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!this.fontMenuOpen) this.openFontDropdown(input.parentElement!);
            if (maxIdx >= minIdx) {
                this.fontHighlight = this.fontHighlight <= minIdx ? maxIdx : this.fontHighlight - 1;
                this.scrollFontOptionIntoView(false);
            }
            return;
        }
        if (event.key === 'Escape' && this.fontMenuOpen) {
            event.preventDefault();
            event.stopPropagation();
            this.fontMenuOpen = false;
            this.fontEditing = false;
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const raw = (this.fontEditing ? this.fontDraft : input.value).trim();
            if (!raw) {
                this.selectAppearanceFont('', input);
                return;
            }
            const exact = this.fontFamilies.find(font => font.toLocaleLowerCase() === raw.toLocaleLowerCase());
            if (exact) {
                this.selectAppearanceFont(exact, input);
            } else if (this.fontHighlight >= 0 && this.matchingFonts[this.fontHighlight]) {
                this.selectAppearanceFont(this.matchingFonts[this.fontHighlight], input);
            } else if (this.fontHighlight === -1 && this.showDefaultFontOption) {
                this.selectAppearanceFont('', input);
            } else {
                this.selectAppearanceFont(raw, input);
            }
        }
    }

    onFontBlur(): void {
        if (this.fontEditing) {
            const raw = this.fontDraft.trim();
            if (!raw) {
                this.applyAppearanceFont('');
            } else {
                const exact = this.fontFamilies.find(font => font.toLocaleLowerCase() === raw.toLocaleLowerCase());
                if (exact) this.applyAppearanceFont(exact);
            }
        }
        this.fontMenuOpen = false;
        this.fontEditing = false;
    }

    selectAppearanceFont(font: string, input?: HTMLInputElement): void {
        this.applyAppearanceFont(font);
        this.fontDraft = font;
        this.fontQuery = '';
        this.fontEditing = false;
        this.fontMenuOpen = false;
        if (input) input.value = font;
    }

    private applyAppearanceFont(font: string): void {
        this.error = '';
        try { this.appearance.setFontFamily(font); }
        catch { this.error = this.i18n.text('无法保存工作台字体。', 'Unable to save workbench font.'); }
    }

    resetAppearanceSize(): void {
        this.error = '';
        try { this.appearance.resetFontSize(); }
        catch { this.error = this.i18n.text('无法重置工作台字号。', 'Unable to reset font size.'); }
    }

    setAppearanceSize(size: number): void {
        this.error = '';
        try { this.appearance.setFontSize(size); }
        catch { this.error = this.i18n.text('无法保存工作台字号。', 'Unable to save font size.'); }
    }

    formatLetterSpacing(spacing: number, auto = false): string {
        const value = `${spacing > 0 ? '+' : ''}${spacing.toFixed(1)} px`;
        return auto ? this.i18n.text(`自动 ${value}`, `Auto ${value}`) : value;
    }

    setAppearanceLetterSpacing(spacing: number): void {
        this.error = '';
        try { this.appearance.setLetterSpacing(spacing); }
        catch { this.error = this.i18n.text('无法保存工作台字间距。', 'Unable to save letter spacing.'); }
    }

    resetAppearanceLetterSpacing(): void {
        this.error = '';
        try { this.appearance.resetLetterSpacing(); }
        catch { this.error = this.i18n.text('无法重置工作台字间距。', 'Unable to reset letter spacing.'); }
    }

    toggleCliEnvMenu(trigger: HTMLElement, event: MouseEvent): void {
        event.stopPropagation();
        if (this.cliEnvMenuOpen) {
            this.cliEnvMenuOpen = false;
            return;
        }
        const rect = trigger.getBoundingClientRect();
        this.cliEnvWidth = Math.max(rect.width, 210);
        this.cliEnvLeft = Math.min(Math.max(8, rect.left), window.innerWidth - this.cliEnvWidth - 8);
        this.cliEnvTop = rect.bottom + 5;
        this.cliEnvMenuOpen = true;
    }

    selectCliEnvironment(distro: string): void {
        this.cliEnvMenuOpen = false;
        this.cliDistro = distro || undefined;
        void this.checkCli();
    }

    restoreSession(item: RemovedSession): void {
        this.error = '';
        try {
            this.workspace.restoreRemovedSession(item);
            this.rebuildRemovedView();
        } catch {
            this.error = this.i18n.text('无法重新添加会话。', 'Unable to restore session.');
        }
    }

    async checkCli(refresh = false): Promise<void> {
        const distro = this.cliDistro;
        if (this.checking && this.checkingDistro === distro) return;
        this.error = '';
        const cached = this.workspace.cachedCli(distro);
        this.detectedCli = cached;
        this.checkingDistro = distro;
        if (cached && !refresh) {
            this.checking = false;
            return;
        }
        this.checking = true;
        this.cdr.detectChanges();
        try {
            const available = await this.workspace.availableCli(distro, refresh);
            if (this.checkingDistro === distro) this.detectedCli = available;
        } catch {
            if (this.checkingDistro === distro && this.page === 'settings' && this.section === 'cli') {
                this.error = this.i18n.text('CLI 检测失败，请重新检测。', 'CLI detection failed. Please retry.');
            }
        } finally {
            if (this.checkingDistro === distro) {
                this.checking = false;
                this.cdr.detectChanges();
            }
        }
    }

    isShortcutUnbound(id: string): boolean {
        const keys = this.config.store.hotkeys[id];
        return !Array.isArray(keys) || !keys.length;
    }

    shortcutKeys(id: string): string {
        const keys = this.config.store.hotkeys[id];
        if (!Array.isArray(keys) || !keys.length) return this.i18n.text('未设置 · 点击录制', 'Not set · Click to record');
        return keys.map(key => Array.isArray(key) ? key.join(' → ') : key).join(' / ');
    }

    toggleHotkeyRecording(id: string, event: MouseEvent): void {
        event.stopPropagation();
        if (this.savingHotkeys) return;
        if (this.recordingHotkeyId === id) {
            this.stopHotkeyRecording();
            return;
        }
        this.hotkeyNotice = '';
        this.hotkeyWarning = '';
        this.recordingHotkeyId = id;
        if (!this.hotkeysDisabled) {
            this.hotkeysDisabled = true;
            this.hotkeys.disable?.();
        }
    }

    stopHotkeyRecording(): void {
        this.recordingHotkeyId = '';
        if (this.hotkeysDisabled) {
            this.hotkeysDisabled = false;
            this.hotkeys.enable?.();
        }
    }

    clearShortcut(id: string, event: MouseEvent): void {
        event.stopPropagation();
        this.stopHotkeyRecording();
        void this.saveHotkeyBinding(id, [], this.i18n.text('已清除快捷键', 'Shortcut cleared'));
    }

    restoreDefaultHotkeys(): void {
        this.stopHotkeyRecording();
        void this.saveAllDefaultHotkeys();
    }

    private findHotkeyConflict(stroke: string, targetId: string): string | undefined {
        const target = stroke.toLowerCase();
        const walk = (branch: Record<string, unknown>, prefix = ''): string | undefined => {
            for (const [key, val] of Object.entries(branch)) {
                const fullId = prefix ? `${prefix}.${key}` : key;
                if (Array.isArray(val) || typeof val === 'string') {
                    if (fullId === targetId) continue;
                    const list = typeof val === 'string' ? [val] : val;
                    const matched = list.some(item => (Array.isArray(item) ? item.join(' ') : String(item)).toLowerCase() === target);
                    if (matched) {
                        const own = workbenchHotkeys.find(h => h.id === fullId);
                        return own ? this.i18n.hotkeyName(own.id, own.name) : fullId;
                    }
                } else if (val && typeof val === 'object') {
                    const nested = walk(val as Record<string, unknown>, fullId);
                    if (nested) return nested;
                }
            }
        };
        return walk(this.config.store.hotkeys ?? {});
    }

    private async saveHotkeyBinding(id: string, keys: string[], notice: string): Promise<void> {
        if (this.savingHotkeys) return;
        this.savingHotkeys = true;
        this.error = '';
        this.hotkeyWarning = '';
        try {
            if (!this.config.store.hotkeys) this.config.store.hotkeys = {};
            this.config.store.hotkeys[id] = keys;
            await this.config.save();
            this.hotkeyNotice = notice;
        } catch {
            this.hotkeyWarning = this.i18n.text('无法保存快捷键设置。', 'Unable to save hotkey setting.');
        } finally {
            this.savingHotkeys = false;
            this.cdr.detectChanges();
        }
    }

    private async saveAllDefaultHotkeys(): Promise<void> {
        if (this.savingHotkeys) return;
        this.savingHotkeys = true;
        this.error = '';
        this.hotkeyWarning = '';
        try {
            if (!this.config.store.hotkeys) this.config.store.hotkeys = {};
            for (const item of workbenchHotkeys) {
                this.config.store.hotkeys[item.id] = [...item.defaultKeys];
            }
            await this.config.save();
            this.hotkeyNotice = this.i18n.text('已恢复推荐快捷键并同步到 Tabby。', 'Recommended shortcuts restored and synced to Tabby.');
        } catch {
            this.hotkeyWarning = this.i18n.text('无法恢复推荐快捷键。', 'Unable to restore recommended shortcuts.');
        } finally {
            this.savingHotkeys = false;
            this.cdr.detectChanges();
        }
    }
}
