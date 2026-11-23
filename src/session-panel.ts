import { ChangeDetectorRef, Component, ElementRef, HostListener, Inject, Input, OnChanges, OnDestroy, OnInit, ViewChild } from '@angular/core';
import type { Subscription } from 'rxjs';
import { cliBrand } from './cli-icons';
import type { HistoryEntry } from './codex';
import type { SessionPrompt } from './codex-data';
import { WorkbenchI18n } from './i18n';
import { summarizeUsage, usagePeriods } from './usage-summary';
import type { DailySeriesBar, DailyUsageCell, ModelUsageRow, SessionUsageRows, UsagePeriod } from './usage-summary';
import { WorkspaceService } from './workspace';
import type { Task } from './workspace';

const projectLimit = 32;

interface SessionOption {
    key: string;
    title: string;
    cliName: string;
    cliIcon: string;
    entry: HistoryEntry;
}

interface FloatingTooltip {
    x: number;
    y: number;
    title: string;
    color?: string;
    monoTitle?: boolean;
    headline: string;
    headlineSub?: string;
    sectionLabel?: string;
    rows: { label: string; value: string; color?: string }[];
}

@Component({
    selector: 'oneai-session-panel',
    styles: [`
        :host { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; color:inherit; container-type:inline-size; }
        button,input { font:inherit; color:inherit; }
        button { cursor:pointer; }
        button:disabled { opacity:.55; cursor:not-allowed; }
        .quiet,time { color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent)); }

        /* 统一自定义圆角下拉框 */
        .cselect-trigger { width:100%; height:34px; padding:0 10px; border-radius:9px; border:1px solid var(--line);
            background:var(--palette-control,var(--theme-bg,#16202c)); display:flex; align-items:center; justify-content:space-between;
            gap:8px; text-align:start; min-width:0; transition:border-color .14s,background .14s,box-shadow .14s; }
        .cselect-trigger:hover:not(:disabled) { background:var(--palette-control-hover,color-mix(in srgb,currentColor 10%,transparent));
            border-color:var(--palette-line-strong,var(--line)); }
        .cselect-trigger[aria-expanded="true"] { border-color:var(--accent);
            box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent); }
        .cselect-value { display:flex; align-items:center; gap:7px; min-width:0; flex:1; }
        .cselect-value img { flex:none; }
        .cselect-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cselect-arrow { color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 68%,transparent)); flex:none; transition:transform .15s; }
        .cselect-trigger[aria-expanded="true"] .cselect-arrow { transform:rotate(180deg); color:var(--accent); }
        .cselect-popover { position:fixed; z-index:95; min-width:190px; max-height:272px; overflow-y:auto; padding:5px;
            border-radius:11px; background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--palette-surface,var(--theme-bg-more,#18222e)),var(--palette-surface,var(--theme-bg-more,#18222e)));
            border:1px solid var(--palette-line-strong,var(--line)); box-shadow:0 14px 36px #0007; display:flex; flex-direction:column; gap:2px; }
        .cselect-option { width:100%; padding:7px 9px; border:0; border-radius:7px; background:transparent;
            color:var(--palette-fg-muted,inherit); display:flex; align-items:center; gap:8px; text-align:start; }
        .cselect-option:hover { background:var(--palette-hover,color-mix(in srgb,currentColor 8%,transparent)); color:var(--palette-fg,inherit); }
        .cselect-option.selected { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent));
            color:var(--palette-fg,inherit); font-weight:600; }
        .cselect-opt-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cselect-opt-meta { font-size:var(--oneai-size-small); padding:1px 5px; border-radius:5px;
            background:color-mix(in srgb,currentColor 8%,transparent); color:var(--palette-fg-subtle,inherit); flex:none; }
        .cselect-opt-check { width:14px; color:var(--accent); flex:none; text-align:center; }

        /* 顶部三级级联筛选栏：项目 -> 会话 -> 模型 */
        .usage-filter-bar { flex:none; display:grid; grid-template-columns:minmax(160px,1fr) 14px minmax(210px,1.45fr) 14px minmax(160px,1fr) auto;
            align-items:end; gap:6px; padding:11px 18px; border-bottom:1px solid var(--line);
            background:color-mix(in srgb,var(--palette-panel,transparent) 55%,var(--palette-surface,transparent)); }
        .filter-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
        .filter-label-row { display:flex; align-items:center; justify-content:space-between; gap:6px; }
        .filter-label { font-size:var(--oneai-size-caption); font-weight:600;
            color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 72%,transparent)); }
        .filter-badge { font-size:var(--oneai-size-small); padding:1px 6px; border-radius:999px;
            background:color-mix(in srgb,var(--accent) 14%,transparent); color:var(--accent); white-space:nowrap; }
        .filter-badge.neutral { background:color-mix(in srgb,currentColor 8%,transparent);
            color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 72%,transparent)); }
        .cascade-arrow { height:34px; display:grid; place-items:center; opacity:.45; }
        .ui-btn { height:34px; padding:0 11px; border-radius:9px; border:1px solid var(--line);
            background:var(--palette-control,var(--theme-bg,#151c25)); display:inline-flex; align-items:center; justify-content:center; gap:6px; }
        .ui-btn:hover:not(:disabled) { background:var(--palette-control-hover,color-mix(in srgb,currentColor 10%,transparent));
            border-color:var(--palette-line-strong,var(--line)); }
        .ui-btn.small { height:24px; padding:0 8px; border-radius:6px; font-size:var(--oneai-size-caption); }
        .ui-btn.primary { color:var(--accent); border-color:color-mix(in srgb,var(--accent) 45%,var(--line));
            background:color-mix(in srgb,var(--accent) 14%,var(--palette-control,transparent)); font-weight:600; }

        /* 用量滚动主体 */
        .usage-body { flex:1; min-height:0; overflow-y:auto; padding:13px 18px 15px; display:flex; flex-direction:column; gap:11px; }
        .period-bar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
        .segmented { display:inline-flex; padding:3px; border-radius:9px;
            background:var(--palette-panel,color-mix(in srgb,currentColor 4%,transparent)); border:1px solid var(--line); gap:2px; }
        .segmented button { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:6px;
            border:1px solid transparent; background:transparent; color:var(--palette-fg-subtle,inherit); font-size:var(--oneai-size-meta); }
        .segmented button:hover { color:var(--palette-fg,inherit); }
        .segmented button[aria-pressed="true"] { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent));
            border-color:color-mix(in srgb,var(--accent) 42%,transparent); color:var(--palette-fg,inherit); font-weight:600; }
        .seg-val { font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-small); font-variant-numeric:tabular-nums;
            padding:1px 5px; border-radius:4px; background:color-mix(in srgb,currentColor 8%,transparent); }
        .segmented button[aria-pressed="true"] .seg-val { background:color-mix(in srgb,var(--accent) 22%,transparent); color:var(--accent); }
        .period-meta { display:flex; align-items:center; gap:8px; font-size:var(--oneai-size-caption); font-variant-numeric:tabular-nums; }

        /* 4 张核心 KPI 卡片 */
        .kpi-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:9px; }
        .kpi-card { padding:11px 13px; border-radius:9px; border:1px solid var(--line);
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); display:flex; flex-direction:column; gap:3px; }
        .kpi-card.primary { background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 12%,var(--palette-elevated,transparent)),var(--palette-elevated,transparent) 68%);
            border-color:color-mix(in srgb,var(--accent) 34%,var(--line)); }
        .kpi-head { display:flex; justify-content:space-between; font-size:var(--oneai-size-caption);
            color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent)); }
        .kpi-value { font-size:calc(var(--oneai-size) * 1.55); font-weight:700; letter-spacing:-.02em;
            font-variant-numeric:tabular-nums; line-height:1.2; }
        .kpi-card.primary .kpi-value { color:var(--accent); }
        .kpi-sub { font-size:var(--oneai-size-caption); color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent));
            font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        /* 通用内容卡片 */
        .panel-card { border:1px solid var(--line); border-radius:9px;
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); padding:12px 14px;
            display:flex; flex-direction:column; gap:9px; }
        .card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
        .card-head-left { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
        .card-title { margin:0; font-size:var(--oneai-size-body); font-weight:600; }
        .card-sub { font-size:var(--oneai-size-caption); color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent));
            font-variant-numeric:tabular-nums; }

        /* 热力图与柱状图 */
        .heatmap-scroll { overflow-x:auto; padding-bottom:2px; }
        .heatmap { display:flex; width:max-content; align-items:flex-end; gap:3px;
            --cell-size:max(10.5px,var(--oneai-size-small)); --cell-gap:3px; --heat-color:var(--palette-success,light-dark(#137b4e,#34d399)); }
        .heatmap-labels,.heatmap-week { display:grid; grid-template-rows:1.35em repeat(7,var(--cell-size)); gap:var(--cell-gap); }
        .heatmap-labels { position:sticky; left:0; background:var(--palette-elevated,var(--theme-bg-more,#18212b)); padding-right:6px; z-index:1; }
        .heatmap-labels span { white-space:nowrap; line-height:var(--cell-size); }
        .heatmap-week { width:var(--cell-size); }
        .heatmap-month { white-space:nowrap; }
        .heatmap-month,.heatmap-labels,.legend { color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent));
            font-size:var(--oneai-size-small); }
        .heat-cell { width:var(--cell-size,10.5px); height:var(--cell-size,10.5px); border-radius:2.5px;
            background:color-mix(in srgb,currentColor 11%,transparent); cursor:pointer; }
        .heat-cell:hover { transform:scale(1.22); outline:1.5px solid currentColor; position:relative; z-index:2; }
        .heat-cell[data-level="1"] { background:color-mix(in srgb,var(--heat-color) 28%,transparent); }
        .heat-cell[data-level="2"] { background:color-mix(in srgb,var(--heat-color) 50%,transparent); }
        .heat-cell[data-level="3"] { background:color-mix(in srgb,var(--heat-color) 74%,transparent); }
        .heat-cell[data-level="4"] { background:var(--heat-color); }
        .legend { display:inline-flex; align-items:center; gap:3.5px; --heat-color:var(--palette-success,light-dark(#137b4e,#34d399)); }
        .legend .heat-cell { width:9px; height:9px; cursor:default; }
        .legend .heat-cell:hover { transform:none; outline:none; }

        .bar-chart { display:grid; align-items:end; gap:6px; height:112px; padding-top:14px; }
        .bar-col { display:flex; flex-direction:column; align-items:center; gap:4px; height:100%; min-width:0; cursor:pointer; }
        .bar-track { flex:1; width:100%; max-width:34px; display:flex; flex-direction:column; justify-content:flex-end;
            border-radius:5px; background:color-mix(in srgb,currentColor 5%,transparent); overflow:hidden; }
        .bar-fill { width:100%; border-radius:4px 4px 0 0;
            background:linear-gradient(180deg,var(--palette-success,#34d399),color-mix(in srgb,var(--accent) 68%,var(--palette-success,#34d399))); }
        .bar-val,.bar-label { font-size:var(--oneai-size-small); color:var(--palette-fg-subtle,inherit);
            font-variant-numeric:tabular-nums; white-space:nowrap; }
        .bar-val { height:13px; }

        /* 模型简略胶囊、堆叠构成条与模型明细表 */
        .model-summary-pills { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
        .model-brief-chip { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px;
            background:var(--palette-panel,color-mix(in srgb,currentColor 5%,transparent)); border:1px solid var(--line);
            font-size:var(--oneai-size-caption); font-variant-numeric:tabular-nums; cursor:pointer; }
        .model-brief-chip:hover { border-color:var(--palette-line-strong,var(--line));
            background:var(--palette-hover,color-mix(in srgb,currentColor 8%,transparent)); }
        .model-brief-chip.active { background:var(--palette-selected,color-mix(in srgb,var(--accent) 18%,transparent));
            border-color:var(--accent); }
        .model-brief-chip b { font-family:var(--oneai-mono-font,Consolas,monospace); font-weight:600; }
        .model-dot { width:7px; height:7px; border-radius:50%; flex:none; display:inline-block; }

        .stacked-bar { height:10px; border-radius:99px; overflow:hidden; display:flex; gap:2px;
            background:color-mix(in srgb,currentColor 11%,transparent); padding:1px; }
        .stacked-seg { height:100%; border-radius:99px; cursor:pointer; transition:filter .14s,transform .14s; }
        .stacked-seg:hover { filter:brightness(1.18); transform:scaleY(1.15); }
        .seg-input { background:var(--accent); }
        .seg-cached { background:var(--palette-success,#34d399); }
        .seg-output { background:var(--palette-violet,#a78bfa); }
        .comp-legend { display:flex; flex-wrap:wrap; gap:14px; font-size:var(--oneai-size-caption); font-variant-numeric:tabular-nums; }
        .comp-item { display:inline-flex; align-items:center; gap:5px; padding:2px 6px; border-radius:6px; cursor:pointer; }
        .comp-item:hover { background:var(--palette-hover,color-mix(in srgb,currentColor 8%,transparent)); }
        .comp-dot { width:8px; height:8px; border-radius:2px; flex:none; }

        .table-wrap { overflow-x:auto; }
        table { width:100%; border-collapse:collapse; font-size:var(--oneai-size-meta); }
        td,th { padding:7px 7px; border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent); text-align:start; }
        th { font-size:var(--oneai-size-caption); color:var(--palette-fg-subtle,inherit); border-bottom-color:var(--line); }
        td:not(:first-child),th:not(:first-child) { text-align:end; white-space:nowrap; font-variant-numeric:tabular-nums; }
        tbody tr { cursor:pointer; }
        tbody tr:hover { background:var(--palette-hover,color-mix(in srgb,currentColor 6%,transparent)); }
        tbody tr.active-row { background:var(--palette-selected,color-mix(in srgb,var(--accent) 16%,transparent)); }
        tbody tr:last-child td { border-bottom:0; }
        .model-name { font-family:var(--oneai-mono-font,Consolas,monospace); font-weight:600; }
        .share-bar { height:3px; width:110px; border-radius:99px; background:color-mix(in srgb,currentColor 11%,transparent);
            overflow:hidden; margin-top:3px; }
        .share-fill { height:100%; border-radius:99px; }

        /* 底部固定免责声明栏 */
        .panel-footer { flex:none; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;
            gap:8px; padding:9px 18px; border-top:1px solid var(--line);
            background:var(--palette-panel,color-mix(in srgb,currentColor 4%,transparent));
            font-size:var(--oneai-size-caption); color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent)); }
        .disclaimer { display:flex; align-items:center; gap:6px; }
        .disclaimer i { color:var(--palette-warning,#fbbf24); }

        /* 历史提示词抽屉 */
        .history-toolbar { flex:none; display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--line);
            background:color-mix(in srgb,var(--palette-panel,transparent) 55%,var(--palette-surface,transparent)); }
        .history-search { flex:1; min-width:0; height:31px; padding:0 10px; border-radius:8px; border:1px solid var(--line);
            background:var(--palette-control,var(--theme-bg,#151c25)); }
        .history-body { flex:1; min-height:0; overflow-y:auto; padding:12px 14px; }
        .prompts { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:10px; }
        .prompts li { padding:10px 12px; border:1px solid var(--line); border-radius:9px;
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent)); display:flex; flex-direction:column; gap:6px; }
        .prompt-meta { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:var(--oneai-size-caption); }
        .prompt-index { font-family:var(--oneai-mono-font,Consolas,monospace); font-weight:600; color:var(--accent);
            background:color-mix(in srgb,var(--accent) 13%,transparent); padding:1px 6px; border-radius:5px; }
        pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; color:inherit; font:inherit; line-height:1.55; user-select:text; }
        .prompt-preview { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
        .prompt-foot { display:flex; align-items:center; justify-content:space-between; }
        .prompt-toggle { border:0; background:transparent; color:var(--accent); padding:2px 5px; border-radius:5px;
            font-size:var(--oneai-size-caption); }
        .prompt-toggle:hover { background:color-mix(in srgb,var(--accent) 12%,transparent); }
        .copy-menu { position:fixed; inset:auto; margin:0; padding:5px; border:1px solid var(--palette-line-strong,var(--line)); border-radius:10px;
            color:inherit; background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--palette-elevated,var(--theme-bg-more,#18212b)),var(--palette-elevated,var(--theme-bg-more,#18212b)));
            box-shadow:0 10px 28px #0007; }
        .copy-menu button { border:0; background:transparent; padding:5px 8px; border-radius:6px; }
        .status-msg { padding:16px 18px; margin:0; }
        .error { color:var(--palette-danger,light-dark(#9b3448,#ffa7b3)); }

        /* 悬浮拆分卡片 Tooltip */
        .floating-tip { position:fixed; pointer-events:none; z-index:99; padding:8px 10px; border-radius:10px;
            background-color:var(--oneai-opaque-base,light-dark(#f4f7fb,#151d28));
            background-image:linear-gradient(var(--palette-panel,var(--theme-bg-more,#141d27)),var(--palette-panel,var(--theme-bg-more,#141d27)));
            border:1px solid var(--palette-line-strong,var(--line));
            box-shadow:0 12px 32px #0007; font-size:var(--oneai-size-caption); min-width:168px; font-variant-numeric:tabular-nums; }
        .tip-title { display:flex; align-items:center; gap:6px; font-weight:600; margin-bottom:3px; }
        .tip-title.mono { font-family:var(--oneai-mono-font,Consolas,monospace); }
        .tip-headline { font-family:var(--oneai-mono-font,Consolas,monospace); font-weight:700; color:var(--accent); margin-bottom:5px; }
        .tip-headline small { color:var(--palette-fg-subtle,inherit); font-weight:500; }
        .tip-section { border-top:1px solid var(--line); padding-top:4px; margin:2px 0 3px;
            font-size:var(--oneai-size-small); color:var(--palette-fg-subtle,inherit); }
        .tip-rows { display:grid; grid-template-columns:auto 1fr; gap:3px 14px; color:var(--palette-fg-subtle,inherit); }
        .tip-val { text-align:end; color:var(--palette-fg-muted,inherit); }

        @container (max-width:44em) {
            .usage-filter-bar { grid-template-columns:1fr; }
            .cascade-arrow { display:none; }
            .kpi-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        }
    `],
    template: `
        <div #copyMenu popover="auto" class="copy-menu" role="group" [attr.aria-label]="i18n.text('提示词操作', 'Prompt actions')">
            <button type="button" autofocus (click)="copyPrompt()"><i class="far fa-copy" aria-hidden="true"></i> {{ i18n.text('复制提示词', 'Copy prompt') }}</button>
        </div>

        <!-- 历史提示词视图 -->
        <ng-container *ngIf="page === 'history'; else usageView">
            <div class="history-toolbar">
                <img *ngIf="brand as cli" width="16" height="16" [src]="cli.source" [alt]="cli.name">
                <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" [title]="title">{{ title }}</strong>
                <span class="filter-badge neutral">{{ filteredPrompts.length }} {{ i18n.text('条', 'items') }}</span>
                <input type="search" class="history-search" [placeholder]="i18n.text('搜索本会话提示词…', 'Search prompts in this session…')" [attr.aria-label]="i18n.text('搜索提示词', 'Search prompts')"
                    [value]="historyQuery" (input)="setHistoryQuery($any($event.target).value)">
                <button type="button" class="ui-btn small" (click)="load()" [disabled]="loading">{{ i18n.text('刷新', 'Refresh') }}</button>
            </div>
            <p *ngIf="loading" class="status-msg quiet" role="status">{{ i18n.text('正在读取…', 'Loading…') }}</p>
            <p *ngIf="error" class="status-msg error" role="alert">{{ error }}</p>
            <div *ngIf="!loading && !error" class="history-body">
                <ol *ngIf="filteredPrompts.length" class="prompts">
                    <li *ngFor="let prompt of filteredPrompts; trackBy: byOrder" tabindex="0"
                        (contextmenu)="openCopyMenu($event, prompt)" (keydown.shift.f10)="openCopyMenu($event, prompt)">
                        <div class="prompt-meta">
                            <span class="prompt-index">#{{ prompt.order < 10 ? '0' + prompt.order : prompt.order }}</span>
                            <time *ngIf="prompt.at">{{ prompt.at | date:'yyyy-MM-dd HH:mm' }}</time>
                        </div>
                        <pre *ngIf="prompt.open; else excerpt">{{ prompt.text }}</pre>
                        <ng-template #excerpt><pre class="prompt-preview">{{ prompt.preview }}</pre></ng-template>
                        <div class="prompt-foot">
                            <button *ngIf="prompt.expandable" type="button" class="prompt-toggle" [attr.aria-expanded]="prompt.open"
                                (click)="prompt.open = !prompt.open">{{ prompt.open ? i18n.text('收起全文', 'Show less') : i18n.text('展开全文', 'Show more') }}</button>
                            <span *ngIf="!prompt.expandable"></span>
                            <button type="button" class="ui-btn small" (click)="copyDirect(prompt.text)">{{ i18n.text('复制', 'Copy') }}</button>
                        </div>
                    </li>
                </ol>
                <p *ngIf="!filteredPrompts.length" class="quiet" style="text-align:center;padding:24px 0">
                    {{ prompts.length ? i18n.text('没有匹配的历史提示词。', 'No matching prompt history.') : entry ? i18n.text('这条会话暂无可读取的提示词记录。', 'No readable prompts recorded in this session.') : i18n.text('当前终端还没有可读取的会话记录。', 'No session records available yet for this terminal.') }}
                </p>
            </div>
            <footer class="panel-footer">
                <span>{{ i18n.text('只读查看历史提示词，支持单条复制或右键菜单。', 'Read-only prompt history. Click Copy or right-click to copy.') }}</span>
                <span *ngIf="copyStatus" role="status" style="color:var(--palette-success,#34d399)">{{ copyStatus }}</span>
            </footer>
        </ng-container>

        <!-- 用量统计视图 -->
        <ng-template #usageView>
            <div class="usage-filter-bar" role="region" [attr.aria-label]="i18n.text('用量筛选', 'Usage filters')">
                <div class="filter-field">
                    <div class="filter-label-row">
                        <span class="filter-label">{{ i18n.text('项目', 'Project') }}</span>
                        <span class="filter-badge neutral">{{ currentProjectEnv }}</span>
                    </div>
                    <button #projectTrigger type="button" class="cselect-trigger" [attr.aria-label]="i18n.text('用量项目', 'Usage project')"
                        [attr.aria-expanded]="openMenu === 'project'" [disabled]="loading || !workspace.projects.length"
                        (click)="toggleDropdown('project', projectTrigger, $event)">
                        <span class="cselect-value"><span class="cselect-text">{{ currentProjectName }}</span></span>
                        <i class="fas fa-angle-down cselect-arrow" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="cascade-arrow" aria-hidden="true"><i class="fas fa-angle-right"></i></div>

                <div class="filter-field">
                    <div class="filter-label-row">
                        <span class="filter-label">{{ i18n.text('会话', 'Session') }}</span>
                        <span class="filter-badge" [class.neutral]="!sessionKey">{{ sessionBadgeLabel }}</span>
                    </div>
                    <button #sessionTrigger type="button" class="cselect-trigger" [attr.aria-label]="i18n.text('用量会话', 'Usage session')"
                        [attr.aria-expanded]="openMenu === 'session'" [disabled]="loading || !sessionOptions.length"
                        (click)="toggleDropdown('session', sessionTrigger, $event)">
                        <span class="cselect-value">
                            <img *ngIf="currentSessionOption?.cliIcon as icon" width="15" height="15" [src]="icon" alt="">
                            <span class="cselect-text">{{ currentSessionLabel }}</span>
                        </span>
                        <i class="fas fa-angle-down cselect-arrow" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="cascade-arrow" aria-hidden="true"><i class="fas fa-angle-right"></i></div>

                <div class="filter-field">
                    <div class="filter-label-row">
                        <span class="filter-label">{{ i18n.text('模型', 'Model') }}</span>
                        <span class="filter-badge" [class.neutral]="!model">{{ modelBadgeLabel }}</span>
                    </div>
                    <button #modelTrigger type="button" class="cselect-trigger" [attr.aria-label]="i18n.text('用量模型', 'Usage model')"
                        [attr.aria-expanded]="openMenu === 'model'" [disabled]="loading || !models.length"
                        (click)="toggleDropdown('model', modelTrigger, $event)">
                        <span class="cselect-value"><span class="cselect-text">{{ currentModelLabel }}</span></span>
                        <i class="fas fa-angle-down cselect-arrow" aria-hidden="true"></i>
                    </button>
                </div>

                <button type="button" class="ui-btn" (click)="reloadUsage()" [disabled]="loading" [title]="i18n.text('重新扫描本地会话日志', 'Rescan local session logs')">{{ i18n.text('刷新', 'Refresh') }}</button>
            </div>

            <!-- 圆角下拉弹出层 -->
            <div *ngIf="openMenu" class="cselect-popover" role="listbox"
                [style.left.px]="menuLeft" [style.top.px]="menuTop" [style.width.px]="menuWidth"
                (click)="$event.stopPropagation()">
                <ng-container *ngIf="openMenu === 'project'">
                    <button *ngFor="let item of workspace.projects; trackBy: byId" type="button" class="cselect-option"
                        [class.selected]="item.id === projectId" (click)="selectProject(item.id)">
                        <span class="cselect-opt-label">{{ item.name }}</span>
                        <span class="cselect-opt-meta">{{ item.distro ? 'WSL · ' + item.distro : 'PS7' }}</span>
                        <span class="cselect-opt-check">{{ item.id === projectId ? '✓' : '' }}</span>
                    </button>
                </ng-container>
                <ng-container *ngIf="openMenu === 'session'">
                    <button type="button" class="cselect-option" [class.selected]="!sessionKey" (click)="selectSession('')">
                        <span class="cselect-opt-label">{{ i18n.text('全部会话（共 ' + sessionOptions.length + ' 条）', 'All sessions (' + sessionOptions.length + ')') }}</span>
                        <span class="cselect-opt-meta">{{ i18n.text('汇总', 'All') }}</span>
                        <span class="cselect-opt-check">{{ !sessionKey ? '✓' : '' }}</span>
                    </button>
                    <button *ngFor="let item of sessionOptions; trackBy: byKey" type="button" class="cselect-option"
                        [class.selected]="item.key === sessionKey" (click)="selectSession(item.key)">
                        <img *ngIf="item.cliIcon" width="15" height="15" [src]="item.cliIcon" alt="">
                        <span class="cselect-opt-label">{{ item.title }}</span>
                        <span class="cselect-opt-meta">{{ item.cliName }}</span>
                        <span class="cselect-opt-check">{{ item.key === sessionKey ? '✓' : '' }}</span>
                    </button>
                </ng-container>
                <ng-container *ngIf="openMenu === 'model'">
                    <button type="button" class="cselect-option" [class.selected]="!model" (click)="selectModel('')">
                        <span class="cselect-opt-label">{{ i18n.text('全部模型（' + models.length + ' 个）', 'All models (' + models.length + ')') }}</span>
                        <span class="cselect-opt-check">{{ !model ? '✓' : '' }}</span>
                    </button>
                    <button *ngFor="let item of models; trackBy: byValue" type="button" class="cselect-option"
                        [class.selected]="item === model" (click)="selectModel(item)">
                        <span class="cselect-opt-label">{{ item }}</span>
                        <span class="cselect-opt-check">{{ item === model ? '✓' : '' }}</span>
                    </button>
                </ng-container>
            </div>

            <p *ngIf="loading" class="status-msg quiet" role="status">{{ i18n.text('正在读取…', 'Loading…') }}</p>
            <p *ngIf="error" class="status-msg error" role="alert">{{ error }}</p>

            <div *ngIf="!loading && !error && report as data" class="usage-body">
                <!-- 周期切换条 -->
                <div class="period-bar">
                    <div class="segmented" role="group" [attr.aria-label]="i18n.text('用量时间范围', 'Usage period')">
                        <button *ngFor="let item of data.summaries; trackBy: byId" type="button" [attr.aria-pressed]="period === item.id"
                            (click)="selectPeriod(item.id)">
                            <span>{{ item.label }}</span>
                            <span class="seg-val">{{ compact.format(item.tokens) }}</span>
                        </button>
                    </div>
                    <div class="period-meta">
                        <span class="filter-badge neutral">{{ scopeCliLabel }}</span>
                        <span class="quiet">{{ data.range }}</span>
                    </div>
                </div>

                <!-- 4 张核心 KPI 卡片 -->
                <div class="kpi-grid">
                    <div class="kpi-card primary">
                        <div class="kpi-head"><span>{{ i18n.text('总 Tokens', 'Total Tokens') }}</span><span>{{ periodLabel }}</span></div>
                        <div class="kpi-value">{{ compact.format(data.totals.tokens) }}</div>
                        <div class="kpi-sub">{{ data.totals.tokens | number }} Tokens</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-head"><span>{{ i18n.text('缓存读取占比', 'Cache Hit Rate') }}</span></div>
                        <div class="kpi-value">{{ data.cacheRate | number:'1.1-1' }}%</div>
                        <div class="kpi-sub">{{ i18n.text('缓存读取 ', 'Cached ') }}{{ compact.format(data.totals.cached) }}</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-head"><span>{{ i18n.text('统计会话', 'Sessions') }}</span></div>
                        <div class="kpi-value">{{ (sessionKey ? 1 : data.activeSessions) | number }}</div>
                        <div class="kpi-sub">{{ sessionKey ? i18n.text('单会话', 'Single session') : i18n.text('共 ' + sessionOptions.length + ' 条会话', sessionOptions.length + ' sessions') }} · {{ data.models.length }} {{ i18n.text('个模型', 'models') }}</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-head"><span>{{ i18n.text('活跃天数', 'Active Days') }}</span></div>
                        <div class="kpi-value">{{ data.activeDays | number }}{{ i18n.text(' 天', 'd') }}</div>
                        <div class="kpi-sub">{{ i18n.text('活跃日均 ', 'Daily avg ') }}{{ compact.format(data.dailyAverage) }}</div>
                    </div>
                </div>

                <!-- 活跃趋势图：近 12 个月热力图 / 本月&本周柱状分布图 -->
                <section class="panel-card" [attr.aria-label]="i18n.text('每日 Token 活跃趋势', 'Daily Token Activity')">
                    <div class="card-head">
                        <div class="card-head-left">
                            <h3 class="card-title">{{ period === 'year' ? i18n.text('每日 Token 活跃热力图', 'Daily Token Heatmap') : period === 'week' ? i18n.text('本周每日消耗分布', 'Weekly Daily Usage') : i18n.text('本月每日消耗分布', 'Monthly Daily Usage') }}</h3>
                            <span class="card-sub">{{ i18n.text('单日峰值 ', 'Peak ') }}{{ compact.format(data.peak) }}</span>
                        </div>
                        <div *ngIf="period === 'year'; else barHint" class="legend">
                            {{ i18n.text('低', 'Less') }}<span *ngFor="let level of levels" class="heat-cell" [attr.data-level]="level"></span>{{ i18n.text('高', 'More') }}
                        </div>
                        <ng-template #barHint><span class="card-sub">{{ i18n.text('悬停柱体查看当日拆分', 'Hover bar for daily breakdown') }}</span></ng-template>
                    </div>

                    <div *ngIf="period === 'year'; else barView" class="heatmap-scroll" tabindex="0" role="region" [attr.aria-label]="i18n.text('每日 Token 热力图', 'Daily token heatmap')">
                        <div class="heatmap">
                            <div class="heatmap-labels"><span></span><span *ngFor="let day of weekdays">{{ day }}</span></div>
                            <div *ngFor="let week of data.weeks; trackBy: byDate" class="heatmap-week">
                                <span class="heatmap-month">{{ week.month }}</span>
                                <ng-container *ngFor="let day of week.days; trackBy: byDate">
                                    <span *ngIf="day.visible; else blankDay" class="heat-cell" [attr.data-level]="day.level"
                                        (mousemove)="showDayTip($event, day)" (mouseleave)="hideTip()"></span>
                                    <ng-template #blankDay><span></span></ng-template>
                                </ng-container>
                            </div>
                        </div>
                    </div>
                    <ng-template #barView>
                        <div class="bar-chart" [style.grid-template-columns]="'repeat(' + data.daySeries.length + ', minmax(0, 1fr))'">
                            <div *ngFor="let bar of data.daySeries; trackBy: byDate" class="bar-col"
                                (mousemove)="showDayTip($event, bar)" (mouseleave)="hideTip()">
                                <span class="bar-val">{{ data.daySeries.length <= 10 && bar.tokens ? compact.format(bar.tokens) : '' }}</span>
                                <div class="bar-track"><div class="bar-fill" [style.height.%]="bar.percent"></div></div>
                                <span class="bar-label">{{ bar.showLabel ? bar.label : '' }}</span>
                            </div>
                        </div>
                    </ng-template>
                </section>

                <!-- 模型用量明细卡片 -->
                <section class="panel-card" [attr.aria-label]="i18n.text('模型用量明细', 'Model Usage Breakdown')">
                    <div class="card-head">
                        <div class="card-head-left">
                            <h3 class="card-title">{{ i18n.text('模型用量明细', 'Model Usage Breakdown') }}</h3>
                            <div *ngIf="data.models.length" class="model-summary-pills">
                                <span class="filter-badge neutral">{{ i18n.text('共 ' + data.models.length + ' 个模型', data.models.length + ' models') }}</span>
                                <span *ngFor="let item of data.models; trackBy: byModel" class="model-brief-chip" [class.active]="model === item.model"
                                    (click)="toggleModel(item.model)"
                                    (mousemove)="showModelTip($event, item, data.totals.tokens)" (mouseleave)="hideTip()">
                                    <span class="model-dot" [style.background]="item.color"></span>
                                    <b>{{ item.model }}</b>
                                    <span>{{ compact.format(item.tokens) }}</span>
                                    <span class="quiet">{{ item.share | number:'1.1-1' }}%</span>
                                </span>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px">
                            <span class="card-sub">{{ i18n.text('悬停统计条或模型查看拆分 · 点击可筛选', 'Hover bar or model for details · Click to filter') }}</span>
                            <button *ngIf="model" type="button" class="ui-btn small primary" (click)="selectModel('')">
                                {{ i18n.text('清除筛选', 'Clear') }} ({{ model }}) ×
                            </button>
                        </div>
                    </div>

                    <ng-container *ngIf="data.models.length && data.totals.tokens > 0; else emptyModels">
                        <div class="stacked-bar">
                            <div class="stacked-seg seg-input" [style.width.%]="(data.totals.input / data.totals.tokens) * 100"
                                (mousemove)="showSegmentTip($event, 'input', i18n.text('输入 (Input Tokens)', 'Input Tokens'), 'var(--accent)', data.totals.input, data.totals.tokens, data.models)"
                                (mouseleave)="hideTip()"></div>
                            <div class="stacked-seg seg-cached" [style.width.%]="(data.totals.cached / data.totals.tokens) * 100"
                                (mousemove)="showSegmentTip($event, 'cached', i18n.text('缓存读取 (Cached Read)', 'Cached Read'), 'var(--palette-success,#34d399)', data.totals.cached, data.totals.tokens, data.models)"
                                (mouseleave)="hideTip()"></div>
                            <div class="stacked-seg seg-output" [style.width.%]="(data.totals.output / data.totals.tokens) * 100"
                                (mousemove)="showSegmentTip($event, 'output', i18n.text('输出 (Output Tokens)', 'Output Tokens'), 'var(--palette-violet,#a78bfa)', data.totals.output, data.totals.tokens, data.models)"
                                (mouseleave)="hideTip()"></div>
                        </div>
                        <div class="comp-legend">
                            <span class="comp-item"
                                (mousemove)="showSegmentTip($event, 'input', i18n.text('输入 (Input Tokens)', 'Input Tokens'), 'var(--accent)', data.totals.input, data.totals.tokens, data.models)"
                                (mouseleave)="hideTip()">
                                <span class="comp-dot seg-input"></span>{{ i18n.text('输入', 'Input') }} <strong>{{ compact.format(data.totals.input) }}</strong>
                                <span class="quiet">({{ (data.totals.input / data.totals.tokens) * 100 | number:'1.1-1' }}%)</span>
                            </span>
                            <span class="comp-item"
                                (mousemove)="showSegmentTip($event, 'cached', i18n.text('缓存读取 (Cached Read)', 'Cached Read'), 'var(--palette-success,#34d399)', data.totals.cached, data.totals.tokens, data.models)"
                                (mouseleave)="hideTip()">
                                <span class="comp-dot seg-cached"></span>{{ i18n.text('缓存读取', 'Cached') }} <strong>{{ compact.format(data.totals.cached) }}</strong>
                                <span class="quiet">({{ (data.totals.cached / data.totals.tokens) * 100 | number:'1.1-1' }}%)</span>
                            </span>
                            <span class="comp-item"
                                (mousemove)="showSegmentTip($event, 'output', i18n.text('输出 (Output Tokens)', 'Output Tokens'), 'var(--palette-violet,#a78bfa)', data.totals.output, data.totals.tokens, data.models)"
                                (mouseleave)="hideTip()">
                                <span class="comp-dot seg-output"></span>{{ i18n.text('输出', 'Output') }} <strong>{{ compact.format(data.totals.output) }}</strong>
                                <span class="quiet">({{ (data.totals.output / data.totals.tokens) * 100 | number:'1.1-1' }}%)</span>
                            </span>
                        </div>

                        <div class="table-wrap">
                            <table [attr.aria-label]="i18n.text('模型用量明细', 'Model usage breakdown')">
                                <thead><tr><th>{{ i18n.text('模型', 'Model') }}</th><th>{{ i18n.text('总 Tokens / 占比', 'Total Tokens / Share') }}</th><th>{{ i18n.text('输入', 'Input') }}</th><th>{{ i18n.text('缓存读取', 'Cached') }}</th><th>{{ i18n.text('输出', 'Output') }}</th></tr></thead>
                                <tbody>
                                    <tr *ngFor="let row of data.models; trackBy: byModel" [class.active-row]="model === row.model"
                                        (click)="toggleModel(row.model)"
                                        (mousemove)="showModelTip($event, row, data.totals.tokens)" (mouseleave)="hideTip()">
                                        <td>
                                            <div style="display:flex;align-items:center;gap:6px">
                                                <span class="model-dot" [style.background]="row.color"></span>
                                                <span class="model-name">{{ row.model }}</span>
                                            </div>
                                            <div class="share-bar"><div class="share-fill" [style.width.%]="row.share" [style.background]="row.color"></div></div>
                                        </td>
                                        <td style="font-weight:600">{{ row.tokens | number }} <span class="quiet" style="font-weight:400">{{ row.share | number:'1.1-1' }}%</span></td>
                                        <td>{{ row.input | number }}</td>
                                        <td>{{ row.cached | number }}</td>
                                        <td>{{ row.output | number }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </ng-container>
                    <ng-template #emptyModels>
                        <p class="quiet" style="text-align:center;margin:14px 0">{{ i18n.text('当前筛选范围在「' + periodLabel + '」内暂无可读取的 Token 记录。', 'No token records found for "' + periodLabel + '" in the current filter.') }}</p>
                    </ng-template>
                </section>
            </div>

            <footer class="panel-footer">
                <div class="disclaimer">
                    <i class="fas fa-info-circle" aria-hidden="true"></i>
                    <span *ngIf="!i18n.isEn">以上统计数据基于本地 CLI 会话日志解析估算，<strong>仅供参考</strong>，实际消耗与计费请以各服务商官方为准。</span>
                    <span *ngIf="i18n.isEn">Usage numbers are estimated from local CLI logs for <strong>reference only</strong>. Refer to your provider for exact billing.</span>
                </div>
                <span>{{ footerCoverageText }}</span>
            </footer>
        </ng-template>

        <!-- 悬浮拆分卡片 Tooltip -->
        <div *ngIf="tooltip as tip" class="floating-tip" role="tooltip" [style.left.px]="tip.x" [style.top.px]="tip.y">
            <div class="tip-title" [class.mono]="tip.monoTitle">
                <span *ngIf="tip.color" class="model-dot" [style.background]="tip.color"></span>
                <span>{{ tip.title }}</span>
            </div>
            <div class="tip-headline">{{ tip.headline }} <small *ngIf="tip.headlineSub">{{ tip.headlineSub }}</small></div>
            <div *ngIf="tip.sectionLabel" class="tip-section">{{ tip.sectionLabel }}</div>
            <div class="tip-rows">
                <ng-container *ngFor="let row of tip.rows">
                    <span style="display:inline-flex;align-items:center;gap:5px">
                        <span *ngIf="row.color" class="model-dot" [style.background]="row.color"></span>
                        <span>{{ row.label }}</span>
                    </span>
                    <span class="tip-val">{{ row.value }}</span>
                </ng-container>
            </div>
        </div>
    `,
})
export class SessionPanelComponent implements OnChanges, OnInit, OnDestroy {
    @ViewChild('copyMenu', { static: true }) private copyMenu!: ElementRef<HTMLElement>;
    @Input() page: 'history' | 'usage' = 'history';
    @Input() session?: Task | HistoryEntry;
    prompts: (SessionPrompt & { order: number; preview: string; open: boolean; expandable: boolean })[] = [];
    filteredPrompts: (SessionPrompt & { order: number; preview: string; open: boolean; expandable: boolean })[] = [];
    historyQuery = '';
    sessionOptions: SessionOption[] = [];
    private usageCache = new Map<string, SessionUsageRows>();
    rows: SessionUsageRows[] = [];
    models: string[] = [];
    model = '';
    period: UsagePeriod = 'year';
    report?: ReturnType<typeof summarizeUsage>;
    limited = false;
    projectId = '';
    sessionKey = '';
    entry?: HistoryEntry;
    loading = false;
    error = '';
    copyStatus = '';
    openMenu: 'project' | 'session' | 'model' | '' = '';
    menuLeft = 0;
    menuTop = 0;
    menuWidth = 200;
    tooltip?: FloatingTooltip;
    private promptToCopy?: string;
    readonly compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
    private readonly exact = new Intl.NumberFormat('en-US');
    weekdays: string[] = ['一', '', '三', '', '五', '', '日'];
    readonly levels = [0, 1, 2, 3, 4];
    readonly byOrder = (_: number, item: { order: number }) => item.order;
    readonly byId = (_: number, item: { id: string }) => item.id;
    readonly byKey = (_: number, item: { key: string }) => item.key;
    readonly byModel = (_: number, item: ModelUsageRow) => item.model;
    readonly byDate = (_: number, item: { date: string }) => item.date;
    readonly byValue = (_: number, value: string) => value;
    private loadId = 0;
    private langSubscription?: Subscription;

    constructor(
        @Inject(WorkspaceService) readonly workspace: WorkspaceService,
        @Inject(ChangeDetectorRef) private readonly cdr: ChangeDetectorRef,
        @Inject(WorkbenchI18n) readonly i18n: WorkbenchI18n,
    ) {
        this.syncWeekdays();
    }

    ngOnInit(): void {
        this.langSubscription = this.i18n.changed$.subscribe(() => {
            this.syncWeekdays();
            if (this.report) this.updateReport();
            this.cdr.markForCheck();
        });
    }

    private syncWeekdays(): void {
        const list = this.i18n.weekdayList();
        this.weekdays = [list[0], '', list[2], '', list[4], '', list[6]];
    }

    @HostListener('document:click')
    closeDropdowns(): void {
        this.openMenu = '';
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        this.openMenu = '';
        this.tooltip = undefined;
    }

    get title(): string {
        const session = this.session ?? this.workspace.selected;
        return session ? 'scope' in session ? session.title : session.name : this.i18n.text('当前会话', 'Current Session');
    }

    get brand() {
        const session = this.session ?? this.workspace.selected;
        return session && cliBrand('scope' in session ? session.cli?.executable ?? 'codex' : session.executable);
    }

    setHistoryQuery(query: string): void {
        this.historyQuery = query;
        this.rebuildFilteredPrompts();
    }

    private rebuildFilteredPrompts(): void {
        const query = this.historyQuery.trim().toLowerCase();
        this.filteredPrompts = query ? this.prompts.filter(item => item.text.toLowerCase().includes(query)) : this.prompts;
    }

    get currentProject() {
        return this.workspace.projects.find(item => item.id === this.projectId) ?? this.workspace.projects[0];
    }

    get currentProjectName(): string {
        return this.currentProject?.name ?? this.i18n.text('当前项目', 'Current Project');
    }

    get currentProjectEnv(): string {
        const project = this.currentProject;
        return project?.distro ? `WSL · ${project.distro}` : 'PowerShell 7';
    }

    get currentSessionOption(): SessionOption | undefined {
        return this.sessionOptions.find(item => item.key === this.sessionKey);
    }

    get currentSessionLabel(): string {
        return this.currentSessionOption?.title ?? this.i18n.text(`全部会话（共 ${this.sessionOptions.length} 条）`, `All sessions (${this.sessionOptions.length})`);
    }

    get sessionBadgeLabel(): string {
        return this.currentSessionOption?.cliName ?? this.i18n.text(`全部 ${this.sessionOptions.length} 条`, `All ${this.sessionOptions.length}`);
    }

    get currentModelLabel(): string {
        if (this.model) return this.model;
        return this.models.length
            ? this.i18n.text(`全部模型（${this.models.length} 个）`, `All models (${this.models.length})`)
            : this.i18n.text('全部模型', 'All models');
    }

    get modelBadgeLabel(): string {
        if (this.model) return this.i18n.text('单模型', 'Single');
        return this.models.length > 1
            ? this.i18n.text(`${this.models.length} 个可选`, `${this.models.length} models`)
            : this.models.length === 1 ? this.i18n.text('仅 1 个', '1 model') : this.i18n.text('无记录', 'None');
    }

    get periodLabel(): string {
        const found = usagePeriods.find(item => item.id === this.period);
        return found ? (this.i18n.isEn ? found.enLabel : found.label) : this.i18n.text('近 12 个月', 'Last 12 Months');
    }

    get scopeCliLabel(): string {
        if (this.currentSessionOption) return this.currentSessionOption.cliName;
        const names = [...new Set(this.sessionOptions.map(item => item.cliName))];
        return names.length ? names.join(' · ') : (this.brand?.name ?? 'AI CLI');
    }

    get hasMissingUsage(): boolean {
        return this.rows.some(item => !item.entries.length);
    }

    get footerCoverageText(): string {
        if (this.currentSessionOption) return this.i18n.text(`单会话视图 · ${this.currentSessionOption.cliName}`, `Single session · ${this.currentSessionOption.cliName}`);
        const missing = this.rows.filter(item => !item.entries.length).length;
        if (this.i18n.isEn) return `Summarized ${this.rows.length} recent sessions${missing ? ` · ${missing} without usage data` : ''}`;
        return `已汇总最近 ${this.rows.length} 条会话${missing ? ` · ${missing} 条缺少明细` : ''}`;
    }

    ngOnChanges(): void {
        this.projectId = '';
        this.sessionKey = '';
        this.model = '';
        this.period = 'year';
        this.historyQuery = '';
        this.filteredPrompts = [];
        this.openMenu = '';
        this.tooltip = undefined;
        this.usageCache.clear();
        void this.load(true);
    }

    ngOnDestroy(): void {
        this.loadId++;
        this.langSubscription?.unsubscribe();
    }

    toggleDropdown(menu: 'project' | 'session' | 'model', trigger: HTMLElement, event: MouseEvent): void {
        event.stopPropagation();
        if (this.openMenu === menu) {
            this.openMenu = '';
            return;
        }
        const rect = trigger.getBoundingClientRect();
        this.menuWidth = Math.max(rect.width, 200);
        this.menuLeft = Math.min(Math.max(8, rect.left), window.innerWidth - this.menuWidth - 8);
        this.menuTop = rect.bottom + 5;
        this.openMenu = menu;
    }

    openCopyMenu(event: MouseEvent | KeyboardEvent, prompt: SessionPrompt): void {
        event.preventDefault();
        event.stopPropagation();
        const menu = this.copyMenu.nativeElement;
        const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const pointer = event instanceof MouseEvent && (event.clientX || event.clientY) ? event : undefined;
        this.promptToCopy = prompt.text;
        if (!menu.isConnected) return;
        try { if (!menu.matches(':popover-open')) menu.showPopover(); } catch { return; }
        menu.style.left = `${Math.max(8, Math.min(pointer?.clientX ?? anchor.left, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(pointer?.clientY ?? anchor.bottom, window.innerHeight - menu.offsetHeight - 8))}px`;
    }

    copyPrompt(): void {
        if (!this.promptToCopy) return;
        this.copyDirect(this.promptToCopy);
        this.copyMenu.nativeElement.hidePopover();
        this.promptToCopy = undefined;
    }

    copyDirect(text: string): void {
        try {
            this.workspace.platform.setClipboard({ text });
            this.copyStatus = this.i18n.text('已复制提示词', 'Copied');
        } catch {
            this.copyStatus = this.i18n.text('无法写入剪贴板', 'Failed to copy');
        }
    }

    selectProject(projectId: string): void {
        this.openMenu = '';
        if (this.projectId === projectId) return;
        this.projectId = projectId;
        this.sessionKey = '';
        this.model = '';
        this.usageCache.clear();
        void this.load(false);
    }

    selectSession(sessionKey: string): void {
        this.openMenu = '';
        if (this.sessionKey === sessionKey) return;
        this.sessionKey = sessionKey;
        this.model = '';
        void this.applySessionScope(++this.loadId);
    }

    selectModel(model: string): void {
        this.openMenu = '';
        this.model = model;
        this.updateReport();
    }

    toggleModel(model: string): void {
        this.tooltip = undefined;
        this.model = this.model === model ? '' : model;
        this.updateReport();
    }

    selectPeriod(period: UsagePeriod): void {
        this.period = period;
        this.updateReport();
    }

    reloadUsage(): void {
        this.usageCache.clear();
        this.workspace.clearHistoryCache(this.currentProject?.distro);
        void this.load(false);
    }

    showDayTip(event: MouseEvent, day: DailyUsageCell | DailySeriesBar): void {
        const pos = this.tipPosition(event);
        this.tooltip = {
            ...pos,
            title: day.date,
            headline: `${this.exact.format(day.tokens)} Tokens`,
            rows: [
                { label: this.i18n.text('输入', 'Input'), value: this.exact.format(day.input) },
                { label: this.i18n.text('缓存读取', 'Cached'), value: this.exact.format(day.cached) },
                { label: this.i18n.text('输出', 'Output'), value: this.exact.format(day.output) },
            ],
        };
    }

    showSegmentTip(
        event: MouseEvent,
        key: 'input' | 'cached' | 'output',
        title: string,
        color: string,
        segTotal: number,
        grandTotal: number,
        models: ModelUsageRow[],
    ): void {
        const pos = this.tipPosition(event);
        const pct = grandTotal > 0 ? ((segTotal / grandTotal) * 100).toFixed(1) : '0.0';
        this.tooltip = {
            ...pos,
            title,
            color,
            headline: `${this.exact.format(segTotal)} Tokens`,
            headlineSub: `(${pct}%)`,
            sectionLabel: this.i18n.text('各模型在该项中的占比：', 'Share by model:'),
            rows: models.map(item => {
                const value = item[key];
                const share = segTotal > 0 ? ((value / segTotal) * 100).toFixed(1) : '0.0';
                return {
                    label: item.model,
                    color: item.color,
                    value: `${this.compact.format(value)} (${share}%)`,
                };
            }),
        };
    }

    showModelTip(event: MouseEvent, row: ModelUsageRow, grandTotal: number): void {
        const pos = this.tipPosition(event);
        const share = grandTotal > 0 ? ((row.tokens / grandTotal) * 100).toFixed(1) : '0.0';
        const pct = (part: number) => row.tokens > 0 ? ((part / row.tokens) * 100).toFixed(1) : '0.0';
        this.tooltip = {
            ...pos,
            title: row.model,
            monoTitle: true,
            color: row.color,
            headline: `${this.exact.format(row.tokens)} Tokens`,
            headlineSub: this.i18n.text(`（占总用量 ${share}%）`, `(${share}% of total)`),
            rows: [
                { label: this.i18n.text('输入', 'Input'), value: `${this.exact.format(row.input)} (${pct(row.input)}%)` },
                { label: this.i18n.text('缓存读取', 'Cached'), value: `${this.exact.format(row.cached)} (${pct(row.cached)}%)` },
                { label: this.i18n.text('输出', 'Output'), value: `${this.exact.format(row.output)} (${pct(row.output)}%)` },
            ],
        };
    }

    hideTip(): void {
        this.tooltip = undefined;
    }

    private tipPosition(event: MouseEvent): { x: number; y: number } {
        const width = 228;
        const height = 148;
        let x = event.clientX + 14;
        let y = event.clientY - height - 10;
        if (x + width > window.innerWidth - 10) x = event.clientX - width - 14;
        if (y < 10) y = event.clientY + 14;
        return { x, y };
    }

    private keyFor(entry: HistoryEntry): string {
        return `${entry.scope.key}|${entry.id}`;
    }

    private optionFor(entry: HistoryEntry): SessionOption {
        const brand = cliBrand(entry.cli?.executable ?? 'codex');
        return {
            key: this.keyFor(entry),
            title: entry.title || this.i18n.text('未命名会话', 'Untitled session'),
            cliName: brand?.name ?? 'Codex',
            cliIcon: brand?.source ?? '',
            entry,
        };
    }

    private updateReport(): void {
        this.report = summarizeUsage(this.rows, this.model, this.period, new Date(), this.i18n.lang);
    }

    async load(initializeScope = false): Promise<void> {
        const id = ++this.loadId;
        this.loading = true;
        this.error = '';
        this.copyStatus = '';
        this.prompts = [];
        this.filteredPrompts = [];
        this.rows = [];
        this.report = undefined;
        this.limited = false;
        this.entry = undefined;
        try {
            const session = this.session ?? this.workspace.selected;
            const entry = session ? 'scope' in session ? session : await this.workspace.entryFor(session) : undefined;
            if (id !== this.loadId) return;
            this.entry = entry;
            if (this.page === 'history') {
                if (entry) {
                    const prompts = await this.workspace.sessionPrompts(entry);
                    if (id === this.loadId) {
                        this.prompts = prompts.map((prompt, index) => {
                            const excerpt = Array.from(prompt.text.replace(/\s+/g, ' ').trim());
                            return {
                                ...prompt,
                                order: index + 1,
                                preview: excerpt.slice(0, 140).join('') + (excerpt.length > 140 ? '…' : ''),
                                open: false,
                                expandable: excerpt.length > 56 || /\r?\n/.test(prompt.text),
                            };
                        }).reverse();
                        this.rebuildFilteredPrompts();
                    }
                }
                return;
            }

            if (initializeScope) {
                const originProject = session
                    ? 'scope' in session ? this.workspace.historyProject(session) : this.workspace.projectFor(session)
                    : undefined;
                this.projectId = originProject?.id ?? this.workspace.projects[0]?.id ?? '';
                this.sessionKey = entry ? this.keyFor(entry) : '';
            }

            const project = this.workspace.projects.find(item => item.id === this.projectId) ?? this.workspace.projects[0];
            if (project) this.projectId = project.id;

            const fetched = project
                ? (await this.workspace.projectSessions(project, projectLimit + 1 + this.workspace.removedSessions.length))
                    .filter(item => !this.workspace.isHistoryRemoved(item))
                : entry ? [entry] : [];
            if (id !== this.loadId) return;

            this.limited = fetched.length > projectLimit;
            const covered = fetched.slice(0, projectLimit);
            const options = covered.map(item => this.optionFor(item));
            if (entry && (!project || this.workspace.historyProject(entry)?.id === project.id)) {
                const currentOpt = this.optionFor(entry);
                if (!options.some(item => item.key === currentOpt.key)) options.unshift(currentOpt);
            }
            this.sessionOptions = options;
            if (this.sessionKey && !this.sessionOptions.some(item => item.key === this.sessionKey)) {
                this.sessionKey = '';
            }

            await this.applySessionScope(id);
        } catch {
            if (id === this.loadId) this.error = this.i18n.text('无法读取当前会话数据。', 'Unable to load session data.');
        } finally {
            if (id === this.loadId) {
                this.loading = false;
                this.cdr.detectChanges();
            }
        }
    }

    private async applySessionScope(id: number): Promise<void> {
        const targets = this.sessionKey
            ? this.sessionOptions.filter(item => item.key === this.sessionKey)
            : this.sessionOptions;
        this.loading = true;
        this.rows = [];
        try {
            for (let start = 0; start < targets.length && id === this.loadId; start += 8) {
                const chunk = await Promise.all(targets.slice(start, start + 8).map(async item => {
                    const cached = this.usageCache.get(item.key);
                    if (cached) return cached;
                    const row: SessionUsageRows = { id: item.key, entries: await this.workspace.sessionUsage(item.entry) };
                    this.usageCache.set(item.key, row);
                    return row;
                }));
                if (id === this.loadId) {
                    this.rows = [...this.rows, ...chunk];
                    this.cdr.detectChanges();
                }
            }
            if (id === this.loadId) {
                this.models = [...new Set(this.rows.flatMap(row => row.entries.map(item => item.model)))].sort();
                if (!this.models.includes(this.model)) this.model = '';
                this.updateReport();
            }
        } catch {
            if (id === this.loadId) this.error = this.i18n.text('无法读取当前会话数据。', 'Unable to load session data.');
        } finally {
            if (id === this.loadId) {
                this.loading = false;
                this.cdr.detectChanges();
            }
        }
    }
}
