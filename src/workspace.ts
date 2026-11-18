import { Inject, Injectable, NgZone, OnDestroy } from '@angular/core';
import { randomUUID } from 'node:crypto';
import { Subscription } from 'rxjs';
import { AppService, PlatformService, ProfilesService } from './host';
import type { App, Platform, Profiles, Tab } from './host';
import { checkDirectory, detect, gitBranch, profileFor, profilePrefix } from './commands';
import type { Command, Project } from './commands';

type TaskStatus = 'starting' | 'running' | 'stopped' | 'failed';
export const statusLabels: Record<TaskStatus, string> = {
    starting: '启动中', running: '运行中', stopped: '已退出', failed: '启动失败',
};

interface TaskRecord extends Command {
    id: string;
    projectId: string;
    name: string;
}

export interface Task extends TaskRecord {
    status: TaskStatus;
    unread: boolean;
    error?: string;
}

const projectsKey = 'tabby-oneai.projects.v1';
const tasksKey = 'tabby-oneai.tasks.v1';

function load<T extends { id: string }>(key: string): T[] {
    try {
        const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(data) ? data.filter(item => typeof item?.id === 'string') : [];
    } catch {
        return [];
    }
}

function save<T extends { id: string }>(key: string, item: T): void {
    localStorage.setItem(key, JSON.stringify([...load<T>(key).filter(entry => entry.id !== item.id), item]));
}

@Injectable()
export class WorkspaceService implements OnDestroy {
    projects = load<Project>(projectsKey);
    tasks: Task[] = load<TaskRecord>(tasksKey).map(task => ({ ...task, status: 'stopped', unread: false }));
    readonly branches = new Map<string, string>();
    readonly folded = new Set<string>();
    collapsed = false;
    selected: Task | null = null;

    private readonly subscriptions = new Subscription();
    private focusSubscription?: Subscription;
    private readonly bindings = new Map<string, { pane: Tab; events: Subscription }>();

    constructor(
        @Inject(AppService) readonly app: App,
        @Inject(ProfilesService) private readonly profiles: Profiles,
        @Inject(PlatformService) readonly platform: Platform,
        @Inject(NgZone) private readonly zone: NgZone,
    ) {
        this.subscriptions.add(this.app.activeTabChange$.subscribe(() => this.watchFocus()));
        this.subscriptions.add(this.app.ready$.subscribe(() => {
            this.watchFocus();
            for (const project of this.projects) void this.refreshBranch(project);
        }));
        this.subscriptions.add(this.app.tabsChanged$.subscribe(() => this.connectRestoredTasks()));
    }

    projectFor(task: Task): Project | undefined {
        return this.projects.find(project => project.id === task.projectId);
    }

    tasksFor(project: Project): Task[] {
        return this.tasks.filter(task => task.projectId === project.id);
    }

    async addProject(name: string, directory: string, distro?: string): Promise<void> {
        const project: Project = { id: randomUUID(), name, directory, distro };
        await checkDirectory(project);
        if (load<Project>(projectsKey).some(item => item.directory === directory && item.distro === distro)) {
            throw new Error('这个运行环境里已经添加了该目录。');
        }
        save(projectsKey, project);
        this.projects = load<Project>(projectsKey);
        void this.refreshBranch(project);
    }

    async createTask(project: Project, name: string, command: Command): Promise<void> {
        const record = { id: randomUUID(), projectId: project.id, name, ...command };
        save(tasksKey, record);
        const task: Task = { ...record, status: 'stopped', unread: false };
        this.tasks.push(task);
        await this.start(task);
    }

    async start(task: Task): Promise<void> {
        if (task.status === 'starting' || task.status === 'running') return;
        const project = this.projectFor(task);
        if (!project) return;
        this.release(task);
        task.status = 'starting';
        task.error = undefined;
        this.selected = task;
        this.folded.delete(task.projectId);
        try {
            await checkDirectory(project);
            if (!await detect(project, task.executable)) throw new Error(`当前环境未找到 ${task.executable}。`);
            const pane = await this.profiles.openNewTabForProfile(profileFor(task.id, `${task.name} · ${project.name}`, project, task));
            if (!pane) throw new Error('Tabby 未能创建本地终端。');
            this.bind(task, pane);
            this.select(task);
        } catch (error) {
            task.status = 'failed';
            task.error = error instanceof Error ? error.message.split('\n')[0] : '启动失败。';
        }
    }

    select(task: Task): void {
        const pane = this.bindings.get(task.id)?.pane;
        if (pane) {
            const parent = this.app.getParentTab(pane);
            if (parent || this.app.tabs.includes(pane)) {
                this.app.selectTab(parent ?? pane);
                parent?.focus?.(pane);
            }
        }
        this.selectTask(task);
    }

    private selectTask(task: Task | null): void {
        this.selected = task;
        if (task) {
            task.unread = false;
            this.folded.delete(task.projectId);
        }
    }

    private watchFocus(): void {
        this.focusSubscription?.unsubscribe();
        const tab = this.app.activeTab;
        this.focusSubscription = tab?.focusChanged$?.subscribe(pane => this.zone.run(() => this.onPaneFocused(pane)));
        this.zone.run(() => this.onPaneFocused(tab?.getFocusedTab?.() ?? tab));
    }

    private onPaneFocused(pane: Tab | null): void {
        const binding = [...this.bindings.entries()].find(([, entry]) => entry.pane === pane);
        this.selectTask(this.tasks.find(task => task.id === binding?.[0]) ?? null);
    }

    private readonly observed = new WeakSet<Tab>();

    private connectRestoredTasks(): void {
        for (const tab of this.app.tabs.flatMap(tab => tab.getAllTabs?.() ?? [tab])) {
            if (this.observed.has(tab)) continue;
            const id = tab.profile?.id;
            if (!id?.startsWith(profilePrefix)) continue;
            const task = this.tasks.find(item => item.id === id.slice(profilePrefix.length));
            if (task && !this.bindings.has(task.id)) this.bind(task, tab);
        }
    }

    private bind(task: Task, pane: Tab): void {
        if (this.bindings.get(task.id)?.pane === pane) return;
        this.release(task);
        this.observed.add(pane);
        const events = new Subscription();
        this.bindings.set(task.id, { pane, events });
        task.status = pane.session?.open ? 'running' : 'starting';
        let sessionEvents: Subscription | undefined;
        const stopped = () => this.zone.run(() => { task.status = 'stopped'; });
        const watchSession = () => {
            sessionEvents?.unsubscribe();
            sessionEvents = new Subscription();
            sessionEvents.add(pane.session?.closed$.subscribe(stopped));
            sessionEvents.add(pane.session?.destroyed$.subscribe(stopped));
        };
        watchSession();
        events.add(pane.sessionChanged$?.subscribe(watchSession));
        events.add(() => sessionEvents?.unsubscribe());
        events.add(pane.destroyed$.subscribe(() => {
            stopped();
            this.release(task);
        }));
        events.add(pane.output$?.subscribe(output => {
            if (task.status === 'starting' && pane.session?.open) {
                this.zone.run(() => { task.status = 'running'; });
            }
            if (output.trim() && task.status === 'running' && !task.unread && this.selected !== task) {
                this.zone.run(() => { task.unread = true; });
            }
        }));
        this.zone.runOutsideAngular(() => {
            const deadline = Date.now() + 15000;
            const timer = setInterval(() => {
                if (task.status !== 'starting') return clearInterval(timer);
                if (pane.session?.open) {
                    this.zone.run(() => { task.status = 'running'; });
                    clearInterval(timer);
                } else if (Date.now() >= deadline) {
                    this.zone.run(() => {
                        task.status = 'failed';
                        task.error = 'Tabby 未报告终端已启动。请检查终端输出。';
                    });
                    clearInterval(timer);
                }
            }, 180);
            events.add(() => clearInterval(timer));
        });
    }

    private release(task: Task): void {
        this.bindings.get(task.id)?.events.unsubscribe();
        this.bindings.delete(task.id);
    }

    private async refreshBranch(project: Project): Promise<void> {
        const branch = await gitBranch(project);
        this.zone.run(() => this.branches.set(project.id, branch));
    }

    ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
        this.focusSubscription?.unsubscribe();
        for (const binding of this.bindings.values()) binding.events.unsubscribe();
    }
}
