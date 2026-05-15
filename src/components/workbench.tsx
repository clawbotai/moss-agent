"use client";

import {
  Activity,
  Bot,
  ClipboardCheck,
  Bug,
  ChevronDown,
  FilePlus2,
  Folder,
  FolderPlus,
  GitBranch,
  MessageSquareText,
  Search,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  AgentDiagnostic,
  BudgetLevel,
  MemoryMode,
  PermissionLevel,
  Project,
  Task,
  TaskMode,
  TaskWithRelations,
} from "@/lib/types";
import { HealthPill } from "@/components/common/HealthPill";
import { AnimatedGradient } from "@/components/common/AnimatedGradient";
import { ProjectSidebar } from "@/components/sidebar/ProjectSidebar";
import { TaskDetail } from "@/components/task/TaskDetail";
import { Composer } from "@/components/composer/Composer";
import { useTaskEvents } from "@/hooks/useTaskEvents";
import { Popover } from "@/components/common/Popover";

type DiagnosticResponse = {
  agents: AgentDiagnostic[];
  packageManagers: { id: string; available: boolean; message: string }[];
};

const quickStarts = [
  {
    title: "探索代码库",
    text: "让 agent 快速理解模块与关键入口。",
    icon: Search,
    prompt: "请探索当前代码库，给出架构概览、关键目录、运行方式和潜在风险。",
  },
  {
    title: "规划功能",
    text: "先做计划审查，再进入实现。",
    icon: ClipboardCheck,
    prompt: "请为这个需求生成实施计划，并让另一个 agent 审查后再开发：",
  },
  {
    title: "修复 Bug",
    text: "复现、定位、修复并输出验证结果。",
    icon: Bug,
    prompt: "请定位并修复这个问题，完成后说明根因、改动和验证结果：",
  },
  {
    title: "需求面谈",
    text: "先反问关键问题，再形成 SPEC。",
    icon: MessageSquareText,
    prompt: "请围绕这个需求进行需求面谈，输出边界、验收标准和实施建议：",
  },
];

export function Workbench({ initialTaskId, initialProjectId }: { initialTaskId?: string; initialProjectId?: string } = {}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticResponse | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || "");
  const [selectedTaskId, setSelectedTaskId] = useState<string>(initialTaskId || "");
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<TaskMode>("collaborative");
  const [budget, setBudget] = useState<BudgetLevel>("standard");
  const [permission, setPermission] = useState<PermissionLevel>("workspaceWrite");
  const [memoryMode, setMemoryMode] = useState<MemoryMode>("taskSummary");
  const [includePromptInContext, setIncludePromptInContext] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAddProject, setShowAddProject] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const projectBadgeRef = useRef<HTMLButtonElement>(null);
  const addProjectBtnRef = useRef<HTMLButtonElement>(null);

  const { taskDetails, setTaskDetails } = useTaskEvents(selectedTaskId || null, (updatedTask) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === updatedTask.id
          ? { ...task, status: updatedTask.status, currentStage: updatedTask.currentStage }
          : task
      )
    );
  });

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  const activeCount = tasks.filter((task) => ["queued", "running", "stuck"].includes(task.status)).length;
  const codex = diagnostics?.agents.find((agent) => agent.id === "codex");
  const claude = diagnostics?.agents.find((agent) => agent.id === "claude");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [projectsResponse, tasksResponse, diagnosticsResponse] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/tasks"),
      fetch("/api/agents/diagnostics"),
    ]);
    const projectsData = (await projectsResponse.json()) as { projects: Project[] };
    const tasksData = (await tasksResponse.json()) as { tasks: Task[] };
    const diagnosticsData = (await diagnosticsResponse.json()) as DiagnosticResponse;
    setProjects(projectsData.projects);
    setTasks(tasksData.tasks);
    setDiagnostics(diagnosticsData);
    setSelectedProjectId((current) => current || projectsData.projects[0]?.id || "");
  }

  async function fetchTask(taskId: string) {
    const response = await fetch(`/api/tasks/${taskId}`);
    if (!response.ok) return;
    const data = (await response.json()) as { task: TaskWithRelations };
    setTaskDetails(data.task);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName || undefined, path: projectPath }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "添加项目失败");
      setProjectPath("");
      setProjectName("");
      await refresh();
      setSelectedProjectId(data.project.id);
    } catch (innerError) {
      setError(innerError instanceof Error ? innerError.message : "添加项目失败");
    } finally {
      setBusy(false);
    }
  }

  async function createTask(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedProjectId || !prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          prompt,
          mode,
          targetAgent: mode === "codexOnly" ? "codex" : mode === "claudeOnly" ? "claude" : null,
          budget,
          permission,
          memoryMode,
          contextPolicy: memoryMode,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建任务失败");
      setPrompt("");
      setSelectedTaskId(data.task.id);
      await refresh();
    } catch (innerError) {
      setError(innerError instanceof Error ? innerError.message : "创建任务失败");
    } finally {
      setBusy(false);
    }
  }

  async function appendTaskMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedTaskId || !prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: prompt, includeInContext: includePromptInContext }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "发送消息失败");
      setPrompt("");
      setIncludePromptInContext(false);
      if (data.task) setTaskDetails(data.task);
    } catch (innerError) {
      setError(innerError instanceof Error ? innerError.message : "发送消息失败");
    } finally {
      setBusy(false);
    }
  }

  async function deriveTask() {
    if (!selectedTaskId || !prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "derive",
          prompt,
          mode,
          targetAgent: mode === "codexOnly" ? "codex" : mode === "claudeOnly" ? "claude" : null,
          budget,
          permission,
          includeMessages: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建派生任务失败");
      setPrompt("");
      setSelectedTaskId(data.task.id);
      await refresh();
    } catch (innerError) {
      setError(innerError instanceof Error ? innerError.message : "创建派生任务失败");
    } finally {
      setBusy(false);
    }
  }

  function startNewTask() {
    setSelectedTaskId("");
    setTaskDetails(null);
    setPrompt("");
    setIncludePromptInContext(false);
    setError("");
  }

  async function createNewTaskFromComposer() {
    setSelectedTaskId("");
    setTaskDetails(null);
    setIncludePromptInContext(false);
    await createTask();
  }

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedTaskId("");
    setTaskDetails(null);
    setError("");
  }

  async function taskAction(action: "cancel" | "retry") {
    if (!selectedTaskId) return;
    await fetch(`/api/tasks/${selectedTaskId}/${action}`, { method: "POST" });
    await fetchTask(selectedTaskId);
    await refresh();
  }

  async function continueTask() {
    if (!selectedTaskId) return;
    await fetch(`/api/tasks/${selectedTaskId}/continue`, { method: "POST" });
    await fetchTask(selectedTaskId);
  }

  async function switchAgent(agent: "claude" | "codex") {
    if (!selectedTaskId) return;
    const response = await fetch(`/api/tasks/${selectedTaskId}/switch-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    });
    const data = await response.json();
    if (response.ok) {
      setSelectedTaskId(data.task.id);
      await refresh();
    }
  }

  return (
    <main className="shell">
      <ProjectSidebar
        tasks={tasks}
        selectedProjectId={selectedProjectId}
        selectedTaskId={selectedTaskId}
        filter={filter}
        onSelectTask={setSelectedTaskId}
        onFilterChange={setFilter}
      />

      <section className="workspace">
        <header className="topbar">
          <div className="topbarLeft">
            <button
              ref={projectBadgeRef}
              className="projectBadge"
              type="button"
              onClick={() => {
                setShowProjectDropdown((v) => !v);
                setShowAddProject(false);
              }}
            >
              <GitBranch size={16} />
              <span>{selectedProject?.name || "未选择项目"}</span>
              <ChevronDown size={14} />
            </button>
            <Popover open={showProjectDropdown} onClose={() => setShowProjectDropdown(false)} wrapperClassName="popoverLeft" triggerRef={projectBadgeRef}>
              <div className="projectDropdown">
                <div className="projectDropdownTitle">切换项目</div>
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={project.id === selectedProjectId ? "projectDropdownItem active" : "projectDropdownItem"}
                    type="button"
                    onClick={() => {
                      selectProject(project.id);
                      setShowProjectDropdown(false);
                    }}
                  >
                    <Folder size={14} />
                    <span>{project.name}</span>
                    <small>{project.path}</small>
                  </button>
                ))}
                {projects.length === 0 && <p className="projectDropdownEmpty">暂无项目</p>}
              </div>
            </Popover>
          </div>
          <div className="topStatus">
            <div className="addProjectWrap">
              <button
                ref={addProjectBtnRef}
                className="newProjectButton"
                type="button"
                onClick={() => {
                  setShowAddProject((v) => !v);
                  setShowProjectDropdown(false);
                }}
              >
                <FolderPlus size={15} />
                新增项目
              </button>
              <Popover open={showAddProject} onClose={() => setShowAddProject(false)} wrapperClassName="popoverRight" triggerRef={addProjectBtnRef}>
                <form
                  className="projectForm inlineProjectForm"
                  onSubmit={async (e) => {
                    await createProject(e);
                    setShowAddProject(false);
                  }}
                >
                  <label>项目目录</label>
                  <input
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="/Users/name/project"
                    autoFocus
                  />
                  <input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="项目名，可选"
                  />
                  <button disabled={busy || !projectPath.trim()} type="submit">
                    <Folder size={15} />
                    添加项目
                  </button>
                </form>
              </Popover>
            </div>
            <button className="newTaskButton" type="button" onClick={startNewTask}>
              <FilePlus2 size={15} />
              新开任务
            </button>
            <HealthPill label="Codex" ok={Boolean(codex?.available)} text={codex?.message || "检测中"} />
            <HealthPill
              label="Claude"
              ok={Boolean(claude?.available)}
              text={claude?.message || "检测中"}
            />
            <div className="livePill">
              <Activity size={14} />
              {activeCount ? `${activeCount} 个任务进行中` : "就绪"}
            </div>
            <button className="iconButton" type="button" aria-label="设置">
              <Settings size={17} />
            </button>
          </div>
        </header>

        <div className={taskDetails ? "content taskContent" : "content"}>
          {!taskDetails && (
            <section className="heroPanel">
              <AnimatedGradient />
              <div className="appIcon">
                <Bot size={34} />
              </div>
              <h1>MOSS 协作调度台</h1>
              <p>选择项目、输入任务，调度 Claude Code 与 Codex 按阶段协作。</p>

              <div className="quickGrid">
                {quickStarts.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.title}
                      className="quickCard"
                      onClick={() => setPrompt(item.prompt)}
                      type="button"
                    >
                      <span>
                        <Icon size={20} />
                      </span>
                      <strong>{item.title}</strong>
                      <small>{item.text}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <TaskDetail
            task={taskDetails}
            onCancel={() => taskAction("cancel")}
            onRetry={() => taskAction("retry")}
            onContinue={continueTask}
            onSwitch={switchAgent}
          />
        </div>

        <Composer
          prompt={prompt}
          mode={mode}
          budget={budget}
          permission={permission}
          memoryMode={memoryMode}
          includePromptInContext={includePromptInContext}
          busy={busy}
          selectedProjectId={selectedProjectId}
          error={error}
          onPromptChange={setPrompt}
          onModeChange={setMode}
          onBudgetChange={setBudget}
          onPermissionChange={setPermission}
          onMemoryModeChange={setMemoryMode}
          onIncludePromptInContextChange={setIncludePromptInContext}
          hasSelectedTask={Boolean(taskDetails)}
          onSubmit={taskDetails ? appendTaskMessage : createTask}
          onCreateTask={() => { void createNewTaskFromComposer(); }}
          onDeriveTask={deriveTask}
        />
      </section>
    </main>
  );
}
