import { Component, ElementRef, Inject, Injector, Input, ViewChild } from '@angular/core';
import { BaseTabComponent } from './host';
import { detect, distributions, environment, supportedCli } from './commands';
import type { Project } from './commands';
import { statusLabels, WorkspaceService } from './workspace';

const theme = `
    :host { color:var(--theme-fg, #e5edf5); --oneai-surface:var(--theme-bg-more, #18212b);
        --oneai-line:color-mix(in srgb, currentColor 16%, transparent);
        --oneai-active:color-mix(in srgb, #29b5e5 17%, transparent);
        --oneai-accent:light-dark(#066e91,#6dd6f5); --oneai-green:light-dark(#146c43,#59dfa5);
        --oneai-amber:light-dark(#845500,#ffca6c); --oneai-red:light-dark(#a52237,#ffa0ae);
        --oneai-purple:light-dark(#674197,#d7b5ff); font-size:14px }
    button { color:inherit; background:transparent; border:0; border-radius:4px; min-height:28px; cursor:pointer }
    button:hover { background:color-mix(in srgb,currentColor 8%,transparent) }
    button:focus-visible { outline:2px solid var(--oneai-accent); outline-offset:-2px }
    .quiet { opacity:.73 }
    .ellipsis { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0 }
    .dot { width:7px; height:7px; border-radius:50%; background:currentColor; flex:none }
    .running { color:var(--oneai-green) } .starting,.unread { color:var(--oneai-amber) }
    .stopped { opacity:.65 } .failed,.error { color:var(--oneai-red) }
`;

@Component({
    selector: 'oneai-projects',
    styles: [theme, `
        :host { display:flex; flex:none; min-width:0; max-width:100% }
        .panel { display:flex; flex-direction:column; position:relative; border-inline-end:1px solid var(--oneai-line);
            background:var(--oneai-surface); max-width:41vw; min-height:0 }
        .panel.standalone { max-width:none; width:100%!important; border:0 }
        header { display:flex; align-items:center; gap:10px; min-height:43px; padding:0 12px; border-bottom:1px solid var(--oneai-line) }
        header strong { font-size:16px; font-weight:600 }
        header button { min-width:25px; padding:0 }
        .tree { overflow:auto; padding:9px; flex:1 1 auto }
        .message { margin:10px; font-size:13px }
        .project { margin-bottom:9px }
        .project-head,.task { display:flex; align-items:center; gap:8px; min-width:0 }
        .project-name { display:flex; align-items:center; gap:8px; min-width:0; flex:1; text-align:start }
        .project-name .fa-folder { color:var(--oneai-accent) }
        .branch { font-size:11px; color:var(--oneai-purple); padding:1px 5px; border-radius:8px;
            border:1px solid color-mix(in srgb,var(--oneai-purple) 40%,transparent); max-width:66px }
        .task-list { margin:2px 0 0 13px; padding-left:7px; border-inline-start:1px solid var(--oneai-line) }
        .task-row { display:flex; gap:3px; align-items:center; border-radius:4px; padding-inline:1px 3px }
        .task-row.active { background:var(--oneai-active); box-shadow:inset 2px 0 var(--oneai-accent) }
        .task { flex:1; padding:5px 7px; text-align:start }
        .task-info { display:grid; min-width:0; font-size:13px }
        .task-info small { font-size:11px }
        footer { border-top:1px solid var(--oneai-line); min-height:39px; padding:4px 9px }
        .rail .tree { padding:4px }
        .rail .project-head { justify-content:center }
        .rail footer { padding:4px }
        .resize { position:absolute; inset:0 -3px 0 auto; width:6px; z-index:2; cursor:col-resize; touch-action:none }
        dialog { color:inherit; background:var(--oneai-surface); border:1px solid var(--oneai-line);
            border-radius:8px; padding:0; width:min(410px,calc(100vw - 24px)); user-select:text }
        dialog::backdrop { background:#080e18a8 }
        form { display:grid; gap:10px; padding:18px }
        form h2 { font-size:17px; margin:0 }
        form label { display:grid; gap:4px; font-size:13px }
        form input,form select { background:var(--theme-bg, #141b24); color:inherit; min-width:0;
            border:1px solid var(--oneai-line); border-radius:5px; padding:6px 8px }
        .directory { display:flex; gap:5px } .directory input { flex:1 }
        .action-row { display:flex; justify-content:flex-end; gap:7px }
        .primary { padding:3px 10px; background:var(--oneai-active); border:1px solid var(--oneai-line) }
        .error { margin:0; overflow-wrap:anywhere }
    `],
    template: `
        <section class="panel" [class.rail]="small" [class.standalone]="standalone" [style.width.px]="small ? 43 : width">
            <header>
                <button *ngIf="!standalone" type="button" [attr.aria-expanded]="!small" [attr.aria-label]="small ? '展开侧栏' : '折叠侧栏'" (click)="workspace.collapsed = !small">
                    <i class="fas" [class.fa-angle-right]="small" [class.fa-angle-down]="!small" aria-hidden="true"></i>
                </button>
                <strong *ngIf="!small">AI 工作台</strong>
            </header>
            <div class="tree">
                <p *ngIf="!small && !workspace.projects.length" class="message quiet">添加项目目录，随后在对应环境中启动 AI CLI。</p>
                <section class="project" *ngFor="let project of workspace.projects; trackBy: byId">
                    <div class="project-head">
                        <button type="button" *ngIf="!small" class="project-name" (click)="toggle(project)" [attr.aria-expanded]="!workspace.folded.has(project.id)" [title]="project.directory">
                            <i class="fas" [class.fa-angle-right]="workspace.folded.has(project.id)" [class.fa-angle-down]="!workspace.folded.has(project.id)" aria-hidden="true"></i>
                            <i class="fas fa-folder" aria-hidden="true"></i><span class="ellipsis">{{ project.name }}</span>
                            <span class="branch ellipsis" *ngIf="workspace.branches.get(project.id)" [title]="workspace.branches.get(project.id)">{{ workspace.branches.get(project.id) }}</span>
                        </button>
                        <button type="button" class="new-task" [title]="'在 ' + project.name + ' 新建任务'" [attr.aria-label]="'在 ' + project.name + ' 新建任务'" (click)="openTask(project)"><i class="fas" [class.fa-folder]="small" [class.fa-plus]="!small" aria-hidden="true"></i></button>
                    </div>
                    <div class="task-list" *ngIf="!small && !workspace.folded.has(project.id)">
                        <div class="task-row" *ngFor="let task of workspace.tasksFor(project); trackBy: byId" [class.active]="workspace.selected === task">
                            <button type="button" class="task" (click)="workspace.select(task)" [attr.aria-current]="workspace.selected === task ? 'true' : null" [title]="task.error || task.name + ' · ' + statusLabels[task.status]">
                                <span class="dot" [class]="task.status" aria-hidden="true"></span>
                                <span class="task-info"><span class="ellipsis">{{ task.name }}</span><small [class.unread]="task.unread" class="ellipsis">{{ task.unread ? '待查看' : statusLabels[task.status] }}</small></span>
                            </button>
                            <button *ngIf="task.status === 'stopped' || task.status === 'failed'" type="button" class="restart" title="重新启动" aria-label="重新启动" (click)="workspace.start(task)"><i class="fas fa-play" aria-hidden="true"></i></button>
                        </div>
                    </div>
                </section>
            </div>
            <footer><button type="button" class="add-project" title="添加项目" aria-label="添加项目" (click)="openProject()"><i class="fas fa-plus" aria-hidden="true"></i><span *ngIf="!small"> 添加项目</span></button></footer>
            <div *ngIf="!standalone && !small" class="resize" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" tabindex="0"
                (pointerdown)="beginResize($event)" (pointermove)="resize($event)" (keydown.arrowleft)="resizeBy(-12, $event)" (keydown.arrowright)="resizeBy(12, $event)"></div>
        </section>
        <dialog #projectDialog aria-label="添加项目">
            <form (submit)="saveProject($event, projectName.value, projectDirectory.value, distro.value)">
                <h2>添加项目</h2>
                <label>运行环境<select #distro (change)="projectDirectory.value = ''"><option value="">PowerShell 7</option><option *ngFor="let item of distros" [value]="item">WSL · {{ item }}</option></select></label>
                <label>目录<div class="directory"><input #projectDirectory required [placeholder]="distro.value ? '/home/user/project' : 'E:\\Project\\MyProject'">
                    <button *ngIf="!distro.value" type="button" (click)="pickDirectory(projectDirectory)">浏览</button></div></label>
                <label>项目名称<input #projectName placeholder="默认使用目录名" maxlength="60"></label>
                <p *ngIf="error" class="error" role="alert">{{ error }}</p>
                <div class="action-row"><button type="button" (click)="projectDialog.close()">取消</button><button class="primary" type="submit" [disabled]="busy">添加</button></div>
            </form>
        </dialog>
        <dialog #taskDialog aria-label="新建任务">
            <form (submit)="saveTask($event, cli.value, taskName.value, executable.value, args.value)">
                <h2>新建任务</h2><span *ngIf="project" class="quiet ellipsis">{{ project.name }} · {{ environment(project) }}</span>
                <label>CLI<select #cli (change)="custom = cli.value === 'custom'"><option *ngFor="let item of cliOptions" [value]="item.executable">{{ item.name }}</option><option value="custom">自定义命令</option></select></label>
                <div [hidden]="!custom">
                    <label>可执行文件<input #executable placeholder="命令名称或完整路径" [required]="custom"></label>
                    <label>参数<input #args placeholder='例如 ["--version"]'></label>
                </div>
                <label>任务名称<input #taskName placeholder="默认使用 CLI 名称" maxlength="60"></label>
                <p *ngIf="error" class="error" role="alert">{{ error }}</p>
                <div class="action-row"><button type="button" (click)="taskDialog.close()">取消</button><button class="primary" type="submit" [disabled]="detecting">{{ detecting ? '检测 CLI…' : '启动' }}</button></div>
            </form>
        </dialog>
    `,
})
export class ProjectsComponent {
    @Input() standalone = false;
    @ViewChild('projectDialog', { static: true }) projectDialog!: ElementRef<HTMLDialogElement>;
    @ViewChild('taskDialog', { static: true }) taskDialog!: ElementRef<HTMLDialogElement>;
    width = 280;
    distros: string[] = [];
    cliOptions: typeof supportedCli = [];
    custom = true;
    detecting = false;
    busy = false;
    error = '';
    project?: Project;
    readonly environment = environment;
    readonly statusLabels = statusLabels;
    readonly byId = (_: number, item: { id: string }) => item.id;

    constructor(@Inject(WorkspaceService) readonly workspace: WorkspaceService) {}

    get small(): boolean { return !this.standalone && this.workspace.collapsed; }

    async openProject(): Promise<void> {
        if (this.busy) return;
        const dialog = this.projectDialog.nativeElement;
        dialog.querySelector('form')?.reset();
        this.error = '';
        dialog.showModal();
        this.distros = await distributions();
    }

    async pickDirectory(input: HTMLInputElement): Promise<void> {
        const directory = await this.workspace.platform.pickDirectory();
        if (directory) input.value = directory;
    }

    async saveProject(event: SubmitEvent, name: string, directory: string, distro: string): Promise<void> {
        event.preventDefault();
        if (this.busy || !directory.trim()) return;
        this.busy = true;
        this.error = '';
        const path = directory.trim();
        try {
            await this.workspace.addProject(name.trim() || path.split(/[\\/]/).filter(Boolean).pop() || path, path, distro || undefined);
            this.projectDialog.nativeElement.close();
        } catch (error) {
            this.error = error instanceof Error ? error.message.split('\n')[0] : '无法添加目录。';
        } finally {
            this.busy = false;
        }
    }

    async openTask(project: Project): Promise<void> {
        const dialog = this.taskDialog.nativeElement;
        this.project = project;
        this.error = '';
        this.cliOptions = [];
        this.custom = true;
        this.detecting = true;
        dialog.querySelector('form')?.reset();
        dialog.showModal();
        const allowed = await Promise.all(supportedCli.map(item => detect(project, item.executable)));
        if (this.project !== project || !dialog.open) return;
        this.cliOptions = supportedCli.filter((_, index) => allowed[index]);
        this.custom = !this.cliOptions.length;
        this.detecting = false;
        setTimeout(() => {
            const select = dialog.querySelector('select');
            if (select && dialog.open) select.value = this.cliOptions[0]?.executable ?? 'custom';
        });
    }

    saveTask(event: SubmitEvent, cli: string, name: string, executable: string, args: string): void {
        event.preventDefault();
        if (this.detecting || !this.project) return;
        const command = cli === 'custom' ? executable.trim() : cli;
        if (!command) return;
        let parsed: unknown = [];
        try {
            if (cli === 'custom' && args.trim()) parsed = JSON.parse(args);
            if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) throw new Error();
        } catch {
            this.error = '参数应为 JSON 字符串数组，例如 ["--version"]。';
            return;
        }
        this.taskDialog.nativeElement.close();
        void this.workspace.createTask(this.project, name.trim() || this.cliOptions.find(item => item.executable === cli)?.name || command, { executable: command, args: parsed });
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

    private setWidth(width: number): void { this.width = Math.min(420, Math.max(205, width)); }
}

@Component({
    selector: 'oneai-status',
    styles: [theme, `
        :host { display:block; flex:none; min-width:0; background:var(--oneai-surface) }
        .bar { display:flex; align-items:center; padding:5px 13px; gap:10px; min-height:36px; border-bottom:1px solid var(--oneai-line) }
        .icon { color:var(--oneai-accent) } strong { font-weight:600 }
        .pill { display:inline-flex; gap:6px; align-items:center; white-space:nowrap; border:1px solid currentColor;
            padding:1px 7px; border-radius:12px; font-size:12px; flex:none }
        .hint { margin-inline-start:auto; font-size:12px }
    `],
    template: `
        <div class="bar" *ngIf="workspace.selected as task" aria-label="任务状态栏">
            <i class="icon fas fa-terminal" aria-hidden="true"></i><strong class="ellipsis" [title]="task.name">{{ task.name }}</strong>
            <span class="pill" [class]="task.status"><span class="dot" aria-hidden="true"></span>{{ statusLabels[task.status] }}</span>
            <span class="quiet ellipsis" *ngIf="workspace.projectFor(task) as project" [title]="project.directory">{{ project.name }} · {{ environment(project) }}</span>
            <span class="hint error ellipsis" *ngIf="task.error" [title]="task.error">{{ task.error }}</span>
        </div>
    `,
})
export class StatusComponent {
    readonly statusLabels = statusLabels;
    readonly environment = environment;
    constructor(@Inject(WorkspaceService) readonly workspace: WorkspaceService) {}
}

@Component({
    selector: 'oneai-workbench-tab',
    styles: [':host { display:flex; flex-direction:column; height:100%; min-height:0 } oneai-projects { flex:1 1 auto; min-height:0 }'],
    template: '<oneai-projects [standalone]="true"></oneai-projects>',
})
export class WorkbenchTab extends BaseTabComponent {
    constructor(@Inject(Injector) injector: Injector) {
        super(injector);
        this.setTitle('AI 工作台');
    }
}
