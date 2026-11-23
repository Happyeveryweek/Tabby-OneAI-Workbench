import { ChangeDetectorRef, Component, HostListener, Inject, OnDestroy, OnInit } from '@angular/core';
import type { Subscription } from 'rxjs';
import { cliDataPathExists, distributions, readCliOutput, runtimeProject } from './commands';
import { defaultAccount } from './codex';
import type { CodexScope } from './codex';
import { defaultDirectoryId, directoryVariables, kimiCodeDirectoryId } from './cli-directories';
import type { CliDirectory } from './cli-directories';
import { supportedCli } from './cli-icons';
import { WorkbenchI18n } from './i18n';
import { WorkspaceService } from './workspace';

const variables = { codex: 'CODEX_HOME', ...directoryVariables, agy: '', grok: '', opencode: '' } as const;
type ListedCli = keyof typeof variables;
interface DirectoryRow { id: string; name: string; directory: string; exists?: boolean; codex?: CodexScope; cli?: CliDirectory; }

@Component({
    selector: 'oneai-cli-directories',
    styles: [`
        :host { display:flex; flex-direction:column; gap:14px; min-width:0; min-height:0; overflow:auto; padding:18px 20px 22px; }
        button,input { font:inherit; color:inherit; }
        button { cursor:pointer; }
        button:disabled { opacity:.55; cursor:not-allowed; }
        .section-title { margin:0 0 2px; font-size:calc(var(--oneai-size) * 1.15); font-weight:600; }
        .section-desc { margin:0; font-size:var(--oneai-size-meta); color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 72%,transparent)); }
        .filter-card { border:1px solid var(--line); border-radius:9px; padding:13px 14px;
            background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent));
            display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
        .filter-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
        .filter-label { font-size:var(--oneai-size-caption); font-weight:600;
            color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 72%,transparent)); }

        /* 统一自定义圆角下拉框 */
        .cselect-trigger { width:100%; height:34px; padding:0 10px; border-radius:9px; border:1px solid var(--line);
            background:var(--palette-control,var(--theme-bg,#151c25)); display:flex; align-items:center; justify-content:space-between;
            gap:8px; text-align:start; min-width:0; }
        .cselect-trigger:hover:not(:disabled) { background:var(--palette-control-hover,color-mix(in srgb,currentColor 10%,transparent));
            border-color:var(--palette-line-strong,var(--line)); }
        .cselect-trigger[aria-expanded="true"] { border-color:var(--accent);
            box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent); }
        .cselect-value { display:flex; align-items:center; gap:7px; min-width:0; flex:1; }
        .cselect-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cselect-arrow { color:var(--palette-fg-subtle,inherit); flex:none; transition:transform .15s; }
        .cselect-trigger[aria-expanded="true"] .cselect-arrow { transform:rotate(180deg); color:var(--accent); }
        .cselect-popover { position:fixed; z-index:95; min-width:190px; max-height:260px; overflow-y:auto; padding:5px;
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

        .directory-heading,.directory-heading > div,.row-main,.directory-detail { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .directory-heading { justify-content:space-between; }
        .directory-heading > div { min-width:0; }
        .env-var-code { font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-caption); color:var(--accent);
            background:color-mix(in srgb,var(--accent) 12%,transparent);
            border:1px solid color-mix(in srgb,var(--accent) 28%,transparent); border-radius:6px; padding:1.5px 6px; overflow-wrap:anywhere; }
        .neutral-pill { font-size:var(--oneai-size-small); padding:1.5px 7px; border-radius:999px;
            background:color-mix(in srgb,currentColor 8%,transparent); color:var(--palette-fg-subtle,inherit); }
        .ui-btn { height:31px; padding:0 11px; border-radius:8px; border:1px solid var(--line);
            background:var(--palette-control,var(--theme-bg,#151c25)); display:inline-flex; align-items:center; justify-content:center; gap:6px; }
        .ui-btn:hover:not(:disabled) { background:var(--palette-control-hover,color-mix(in srgb,currentColor 10%,transparent));
            border-color:var(--palette-line-strong,var(--line)); }
        .ui-btn.primary { color:var(--accent); border-color:color-mix(in srgb,var(--accent) 45%,var(--line));
            background:color-mix(in srgb,var(--accent) 14%,var(--palette-control,transparent)); font-weight:600; }
        .ui-btn.small { height:25px; padding:0 8px; border-radius:6px; font-size:var(--oneai-size-caption); }

        .directory-list,.form { background:var(--palette-elevated,color-mix(in srgb,currentColor 4%,transparent));
            border:1px solid var(--line); border-radius:9px; }
        .form { display:flex; align-items:end; flex-wrap:wrap; gap:8px; padding:12px 14px;
            border-color:color-mix(in srgb,var(--accent) 42%,var(--line)); }
        .form label { display:grid; gap:5px; flex:1 1 8em; min-width:0; font-size:var(--oneai-size-caption); font-weight:600; }
        .form .directory-input { flex-grow:2; }
        .ui-input { min-width:0; width:100%; height:33px; padding:0 10px; border-radius:8px; border:1px solid var(--line);
            background:var(--palette-control,var(--theme-bg,#151c25)); font-weight:400; }
        .directory-list { margin:0; padding:0; list-style:none; overflow:hidden; }
        .directory-list li { padding:12px 14px; }
        .directory-list li + li { border-top:1px solid var(--line); }
        .row-main { justify-content:space-between; }
        .row-main strong { display:inline-flex; align-items:center; gap:7px; min-width:0; overflow-wrap:anywhere; }
        .row-main i { color:var(--accent); }
        .preferred { padding:1.5px 7px; border-radius:999px; font-size:var(--oneai-size-small);
            color:var(--accent); background:color-mix(in srgb,var(--accent) 14%,transparent);
            border:1px solid color-mix(in srgb,var(--accent) 32%,transparent); white-space:nowrap; }
        .directory-detail { margin-top:6px; justify-content:space-between; }
        .location { flex:1 1 10em; min-width:0; font-family:var(--oneai-mono-font,Consolas,monospace); font-size:var(--oneai-size-caption);
            background:color-mix(in srgb,currentColor 5%,transparent); padding:2px 7px; border-radius:6px;
            color:inherit; overflow-wrap:anywhere; user-select:text; }

        /* 统一状态胶囊 */
        .state-badge { display:inline-flex; align-items:center; gap:5px; height:19px; padding:0 7px; border-radius:999px;
            font-size:var(--oneai-size-small); font-weight:600; white-space:nowrap;
            color:var(--state-color); background:color-mix(in srgb,var(--state-color) 13%,transparent);
            border:1px solid color-mix(in srgb,var(--state-color) 32%,transparent); }
        .state-badge::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
        .state-ok { --state-color:var(--palette-success,light-dark(#096b4c,#34d399)); }
        .state-warn { --state-color:var(--palette-warning,light-dark(#895c06,#fbbf24)); }
        .state-neutral { --state-color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 70%,transparent)); }
        small { color:var(--palette-fg-subtle,color-mix(in srgb,currentColor 72%,transparent)); }
        .error { color:var(--palette-danger,light-dark(#93283c,#ff9aa7)); margin:0; }
    `],
    template: `
        <div>
            <h3 class="section-title">{{ i18n.text('CLI 环境与目录', 'CLI Environments & Directories') }}</h3>
            <p class="section-desc">{{ i18n.text('按运行环境配置各 CLI 数据目录与默认启动项，路径右侧实时显示存在状态。', 'Configure CLI data directories and defaults per runtime environment. Path existence is checked live.') }}</p>
        </div>

        <div class="filter-card">
            <div class="filter-field">
                <span class="filter-label">AI CLI</span>
                <button #cliTrigger type="button" class="cselect-trigger" aria-label="AI CLI"
                    [attr.aria-expanded]="openMenu === 'cli'" [disabled]="busy"
                    (click)="toggleMenu('cli', cliTrigger, $event)">
                    <span class="cselect-value">
                        <img *ngIf="selectedCliBrand as cli" width="15" height="15" [src]="cli.source" [class.codex-mark]="cli.executable === 'codex'" alt="">
                        <span class="cselect-text">{{ selectedCliBrand?.name ?? executable }}</span>
                    </span>
                    <i class="fas fa-angle-down cselect-arrow" aria-hidden="true"></i>
                </button>
            </div>
            <div class="filter-field">
                <span class="filter-label">{{ i18n.text('运行环境', 'Runtime') }}</span>
                <button #envTrigger type="button" class="cselect-trigger" [attr.aria-label]="i18n.text('目录运行环境', 'Directory runtime environment')"
                    [attr.aria-expanded]="openMenu === 'env'" [disabled]="busy"
                    (click)="toggleMenu('env', envTrigger, $event)">
                    <span class="cselect-value"><span class="cselect-text">{{ distro ? 'WSL · ' + distro : 'PowerShell 7' }}</span></span>
                    <i class="fas fa-angle-down cselect-arrow" aria-hidden="true"></i>
                </button>
            </div>
        </div>

        <div *ngIf="openMenu" class="cselect-popover" role="listbox"
            [style.left.px]="menuLeft" [style.top.px]="menuTop" [style.width.px]="menuWidth"
            (click)="$event.stopPropagation()">
            <ng-container *ngIf="openMenu === 'cli'">
                <button *ngFor="let cli of cliOptions; trackBy: byExec" type="button" class="cselect-option"
                    [class.selected]="cli.executable === executable" (click)="selectCli($any(cli.executable))">
                    <img width="15" height="15" [src]="cli.source" [class.codex-mark]="cli.executable === 'codex'" alt="">
                    <span class="cselect-opt-label">{{ cli.name }}</span>
                    <span class="cselect-opt-meta">{{ cli.executable }}</span>
                    <span class="cselect-opt-check">{{ cli.executable === executable ? '✓' : '' }}</span>
                </button>
            </ng-container>
            <ng-container *ngIf="openMenu === 'env'">
                <button type="button" class="cselect-option" [class.selected]="!distro" (click)="selectDistro('')">
                    <span class="cselect-opt-label">PowerShell 7</span>
                    <span class="cselect-opt-meta">Windows</span>
                    <span class="cselect-opt-check">{{ !distro ? '✓' : '' }}</span>
                </button>
                <button *ngFor="let item of distros; trackBy: byValue" type="button" class="cselect-option"
                    [class.selected]="item === distro" (click)="selectDistro(item)">
                    <span class="cselect-opt-label">WSL · {{ item }}</span>
                    <span class="cselect-opt-meta">Linux</span>
                    <span class="cselect-opt-check">{{ item === distro ? '✓' : '' }}</span>
                </button>
            </ng-container>
        </div>

        <div class="directory-heading">
            <div>
                <strong>{{ executable === 'opencode' ? i18n.text('会话数据库', 'Session Database') : i18n.text('数据目录', 'Data Directories') }}</strong>
                <code *ngIf="variable" class="env-var-code" [title]="i18n.text('环境变量', 'Environment variable')">{{ variable }}</code>
                <span *ngIf="!variable" class="neutral-pill">{{ i18n.text('固定默认路径', 'Fixed default path') }}</span>
            </div>
            <div>
                <button type="button" class="ui-btn refresh-directories" (click)="refresh()" [disabled]="busy">
                    <i class="fas fa-sync-alt" aria-hidden="true"></i>{{ busy ? i18n.text('处理中…', 'Working…') : i18n.text('刷新会话', 'Refresh') }}
                </button>
                <button *ngIf="variable" type="button" class="ui-btn primary add-directory" (click)="adding = !adding" [disabled]="busy" [attr.aria-expanded]="adding">
                    <i class="fas fa-folder-plus" aria-hidden="true"></i>{{ adding ? i18n.text('取消添加', 'Cancel') : i18n.text('添加目录', 'Add Directory') }}
                </button>
            </div>
        </div>

        <form *ngIf="adding" class="form" (submit)="saveDirectory($event, name.value, directory.value)">
            <label>{{ i18n.text('名称', 'Name') }}<input #name class="ui-input" required maxlength="40" [placeholder]="i18n.text('例如：测试账号', 'e.g. Work profile')"></label>
            <label class="directory-input">{{ i18n.text('目录', 'Directory') }}<input #directory class="ui-input" required [placeholder]="i18n.text('绝对路径', 'Absolute path')"></label>
            <button type="submit" class="ui-btn primary" [disabled]="busy">{{ i18n.text('保存', 'Save') }}</button>
        </form>

        <p *ngIf="notice" role="status" style="margin:0"><small>{{ notice }}</small></p>
        <p *ngIf="error" class="error" role="alert">{{ error }}</p>
        <p *ngIf="loading" style="margin:0"><small>{{ i18n.text('正在读取目录…', 'Reading directories…') }}</small></p>
        <p *ngIf="!loading && !rows.length" style="margin:0"><small>{{ i18n.text('当前环境未返回目录。', 'No directories found in this environment.') }}</small></p>

        <ul *ngIf="rows.length" class="directory-list">
            <li *ngFor="let row of rows; trackBy: byId">
                <div class="row-main">
                    <strong>
                        <img *ngIf="selectedCliBrand as cli; else folderIcon" width="15" height="15" [src]="cli.source" [class.codex-mark]="cli.executable === 'codex'" alt="">
                        <ng-template #folderIcon><i class="fas" [ngClass]="executable === 'opencode' ? 'fa-database' : 'fa-folder'" aria-hidden="true"></i></ng-template>
                        <span>{{ row.name }}</span>
                    </strong>
                    <span *ngIf="variable && preferredId === row.id" class="preferred">{{ i18n.text('默认启动', 'Default') }}</span>
                    <button *ngIf="variable && preferredId !== row.id && !isLegacyKimi(row)" type="button" class="ui-btn small" (click)="setPreferred(row)">{{ i18n.text('设为默认启动', 'Set Default') }}</button>
                </div>
                <div class="directory-detail">
                    <code class="location">{{ row.directory }}</code>
                    <small *ngIf="isLegacyKimi(row)" [title]="i18n.text('旧版环境变量', 'Legacy environment variable')">KIMI_SHARE_DIR</small>
                    <span class="state-badge" [class.state-ok]="row.exists === true" [class.state-warn]="row.exists === false" [class.state-neutral]="row.exists === undefined">
                        {{ row.exists === true ? i18n.text('存在', 'Exists') : row.exists === false ? i18n.text('不存在', 'Missing') : i18n.text('无法检查', 'Unknown') }}
                    </span>
                </div>
            </li>
        </ul>
    `,
})
export class CliDirectoriesPanel implements OnInit, OnDestroy {
    rows: DirectoryRow[] = [];
    distros: string[] = [];
    distro?: string;
    executable: ListedCli = 'codex';
    error = '';
    notice = '';
    adding = false;
    busy = false;
    loading = false;
    openMenu: 'cli' | 'env' | '' = '';
    menuLeft = 0;
    menuTop = 0;
    menuWidth = 200;
    private loadId = 0;
    private langSubscription?: Subscription;
    readonly cliOptions = supportedCli.filter(cli => Object.prototype.hasOwnProperty.call(variables, cli.executable));
    readonly byId = (_: number, row: DirectoryRow) => row.id;
    readonly byExec = (_: number, cli: { executable: string }) => cli.executable;
    readonly byValue = (_: number, value: string) => value;

    constructor(
        @Inject(WorkspaceService) readonly workspace: WorkspaceService,
        @Inject(WorkbenchI18n) readonly i18n: WorkbenchI18n,
        @Inject(ChangeDetectorRef) private readonly cdr: ChangeDetectorRef,
    ) {}

    @HostListener('document:click')
    closeMenu(): void {
        this.openMenu = '';
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        this.openMenu = '';
    }

    ngOnInit(): void {
        this.langSubscription = this.i18n.changed$.subscribe(() => {
            void this.load();
            this.cdr.markForCheck();
        });
        const existing = [...new Set(this.workspace.projects.map(item => item.distro).filter((item): item is string => Boolean(item)))];
        this.distros = existing;
        void distributions().then(items => {
            this.distros = [...new Set([...items, ...existing])];
            this.cdr.markForCheck();
        });
        void this.load();
    }

    ngOnDestroy(): void {
        this.langSubscription?.unsubscribe();
    }

    get selectedCliBrand() {
        return this.cliOptions.find(item => item.executable === this.executable);
    }

    get variable(): string { return variables[this.executable]; }

    isLegacyKimi(row: DirectoryRow): boolean {
        return this.executable === 'kimi' && row.id === defaultDirectoryId && this.rows[0]?.id === kimiCodeDirectoryId;
    }

    get preferredId(): string {
        const { executable, distro } = this;
        if (executable === 'codex') return this.workspace.codex.preferred(distro);
        if (executable === 'agy' || executable === 'grok' || executable === 'opencode') return defaultDirectoryId;
        return this.workspace.cliDirectories.preferred(executable, distro)?.id
            ?? (executable === 'kimi' ? this.rows[0]?.id : undefined) ?? defaultDirectoryId;
    }

    toggleMenu(menu: 'cli' | 'env', trigger: HTMLElement, event: MouseEvent): void {
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

    selectCli(executable: ListedCli): void {
        this.openMenu = '';
        if (this.executable === executable) return;
        this.executable = executable;
        this.changeSelection();
    }

    selectDistro(distro: string): void {
        this.openMenu = '';
        const next = distro || undefined;
        if (this.distro === next) return;
        this.distro = next;
        this.changeSelection();
    }

    private changeSelection(): void {
        this.adding = false;
        this.error = this.notice = '';
        void this.load();
    }

    private async load(): Promise<void> {
        const { executable, distro } = this;
        const id = ++this.loadId;
        this.loading = true;
        this.rows = [];
        try {
            let rows: DirectoryRow[];
            if (executable === 'codex') {
                const scopes = (await this.workspace.codex.scopes([distro])).filter(scope => scope.distro === distro);
                rows = scopes.map(scope => ({ id: scope.id, name: scope.id === defaultAccount ? this.i18n.text('环境默认目录', 'Default environment directory') : scope.name,
                    directory: scope.directory, codex: scope }));
            } else if (executable === 'agy' || executable === 'grok' || executable === 'opencode') {
                const directory = executable === 'opencode'
                    ? await readCliOutput(runtimeProject(distro), { executable, args: ['debug', 'paths', 'db'] })
                    : (await this.workspace.cliDirectories.homes(distro))[executable];
                rows = directory ? [{ id: defaultDirectoryId, name: executable === 'opencode' ? this.i18n.text('当前数据库', 'Current database') : this.i18n.text('环境默认目录', 'Default environment directory'), directory }] : [];
            } else {
                rows = (await this.workspace.cliDirectories.scopes(executable, distro)).map(scope => ({ ...scope, cli: scope }));
            }
            const results = await Promise.all(rows.map(async row => ({
                ...row, exists: await cliDataPathExists(row.directory, distro, executable === 'opencode'),
            })));
            if (id === this.loadId) this.rows = results;
        } catch { /* An unavailable CLI does not prevent choosing another environment. */ }
        finally {
            if (id === this.loadId) {
                this.loading = false;
                this.cdr.markForCheck();
            }
        }
    }

    async saveDirectory(event: SubmitEvent, name: string, directory: string): Promise<void> {
        event.preventDefault();
        const { executable, distro } = this;
        if (this.busy || executable === 'agy' || executable === 'grok' || executable === 'opencode') return;
        this.busy = true;
        this.error = this.notice = '';
        try {
            if (executable === 'codex') await this.workspace.codex.addAccount(name.trim(), directory.trim(), distro);
            else await this.workspace.cliDirectories.add(executable, name.trim(), directory.trim(), distro);
            this.adding = false;
            await this.reloadHistory();
        } catch (error) {
            this.error = error instanceof Error ? error.message.split('\n')[0] : this.i18n.text('无法保存目录。', 'Unable to save directory.');
        } finally { this.busy = false; }
    }

    async refresh(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.error = this.notice = '';
        try { await this.reloadHistory(); }
        finally { this.busy = false; }
    }

    private async reloadHistory(): Promise<void> {
        await this.workspace.refreshRuntimeHistory(this.distro);
        await this.load();
        this.notice = this.i18n.text('已重新扫描当前环境的项目会话。', 'Rescanned project sessions for this environment.');
    }

    setPreferred(row: DirectoryRow): void {
        if (row.codex) this.workspace.codex.setPreferred(row.codex);
        else if (row.cli) this.workspace.cliDirectories.setPreferred(row.cli);
    }
}
