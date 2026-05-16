"use client";

import {
  Activity,
  Bot,
  ClipboardCheck,
  Bug,
  ChevronDown,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  MessageSquareText,
  Search,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  AgentDiagnostic,
  BudgetLevel,
  PermissionLevel,
  Project,
  Task,
  TaskMessage,
  TaskMode,
  TaskStage,
  TaskWithRelations,
} from "@/lib/types";
import { HealthPill } from "@/components/common/HealthPill";
import { AnimatedGradient } from "@/components/common/AnimatedGradient";
import { ProjectSidebar } from "@/components/sidebar/ProjectSidebar";
import { TaskDetail } from "@/components/task/TaskDetail";
import { Composer } from "@/components/composer/Composer";
import { useTaskEvents } from "@/hooks/useTaskEvents";
import { Popover } from "@/components/common/Popover";
import { SettingsPopover } from "@/components/settings/SettingsPopover";

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
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAddProject, setShowAddProject] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const projectBadgeRef = useRef<HTMLButtonElement>(null);
  const addProjectBtnRef = useRef<HTMLButtonElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  // 乐观更新状态：与 taskDetails 分离，避免 SSE 事件覆盖
  const [optimisticMessages, setOptimisticMessages] = useState<TaskMessage[]>([]);
  const [optimisticStages, setOptimisticStages] = useState<TaskStage[]>([]);
  const pendingAbortRef = useRef<AbortController | null>(null);
  const optimisticIdRef = useRef(0);
  const mountedRef = useRef(true);

  // 组件卸载时中断进行中的请求
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      pendingAbortRef.current?.abort();
    };
  }, []);

  const { taskDetails, setTaskDetails } = useTaskEvents(selectedTaskId || null, (updatedTask) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === updatedTask.id
          ? { ...task, status: updatedTask.status, currentStage: updatedTask.currentStage }
          : task
      )
    );
  });

  // 合并 taskDetails 与乐观数据用于渲染（乐观数据不受 SSE 影响）
  const mergedTaskDetails = useMemo<TaskWithRelations | null>(() => {
    if (!taskDetails) return null;
    if (optimisticMessages.length === 0 && optimisticStages.length === 0) return taskDetails;
    return {
      ...taskDetails,
      messages: [...taskDetails.messages, ...optimisticMessages],
      stages: [...taskDetails.stages, ...optimisticStages],
    };
  }, [taskDetails, optimisticMessages, optimisticStages]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  const activeCount = tasks.filter((task) => ["queued", "running", "stuck"].includes(task.status)).length;
  const codex = diagnostics?.agents.find((agent) => agent.id === "codex");
  const claude = diagnostics?.agents.find((agent) => agent.id === "claude");

  useEffect(() => {
    void refresh();
  }, []);

  // 派生任务可能属于不同项目，自动同步侧边栏选中的项目
  useEffect(() => {
    if (taskDetails?.projectId) {
      setSelectedProjectId(taskDetails.projectId);
    }
  }, [taskDetails?.projectId]);

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
    const promptText = prompt;
    setPrompt("");

    // 乐观更新：使用独立状态，不与 taskDetails 耦合，避免被 SSE 事件覆盖
    const now = new Date().toISOString();
    const maxOrder = taskDetails?.stages?.length
      ? Math.max(...taskDetails.stages.map((s) => s.orderIndex))
      : -1;
    const optimisticId = ++optimisticIdRef.current;
    setOptimisticMessages([{
      id: `optimistic-msg-${optimisticId}`,
      taskId: selectedTaskId,
      role: "user",
      content: promptText,
      includeInContext: true,
      createdAt: now,
    }]);
    setOptimisticStages([{
      id: `optimistic-stage-${optimisticId}`,
      taskId: selectedTaskId,
      name: "追加任务中…",
      agent: "claude",
      role: "plan",
      status: "running",
      inputSummary: null,
      outputSummary: null,
      startedAt: now,
      completedAt: null,
      errorMessage: null,
      // stages 为空时使用高哨兵值，避免与服务器分配的 orderIndex 冲突
      orderIndex: maxOrder >= 0 ? maxOrder + 1 : 1000,
    }]);

    // 创建 AbortController 支持组件卸载时中断请求
    const abortController = new AbortController();
    pendingAbortRef.current = abortController;

    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}/messages`, {
        signal: abortController.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: promptText,
          includeInContext: true,
        }),
      });
      const data = (await response.json()) as { task?: TaskWithRelations; error?: string };
      if (!response.ok) throw new Error(data.error || "追加任务说明失败");
      if (!mountedRef.current) return; // 组件已卸载
      // 成功：清除乐观数据，让真实数据接管渲染
      setOptimisticMessages([]);
      setOptimisticStages([]);
      if (data.task) {
        const appendedTask = data.task;
        setTaskDetails(appendedTask);
        setTasks((current) => current.map((task) => (task.id === appendedTask.id ? appendedTask : task)));
      } else {
        await refresh();
      }
    } catch (innerError) {
      if (abortController.signal.aborted || !mountedRef.current) return; // 组件已卸载，不做任何操作
      // 失败：清除乐观数据、恢复用户输入
      setOptimisticMessages([]);
      setOptimisticStages([]);
      setPrompt(promptText);
      setError(innerError instanceof Error ? innerError.message : "追加任务说明失败");
    } finally {
      pendingAbortRef.current = null;
      setBusy(false);
    }
  }

  function startNewTask() {
    setSelectedTaskId("");
    setTaskDetails(null);
    setPrompt("");
    setError("");
    setOptimisticMessages([]);
    setOptimisticStages([]);
  }

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedTaskId("");
    setTaskDetails(null);
    setError("");
    setOptimisticMessages([]);
    setOptimisticStages([]);
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
              className={`projectBadge${showProjectDropdown ? " chevronOpen" : ""}`}
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
                  <div className="directoryPicker">
                    <div className="directoryPickerInput">
                      <input
                        value={projectPath}
                        onChange={(e) => setProjectPath(e.target.value)}
                        placeholder="/Users/name/project"
                        autoFocus
                      />
                    </div>
                    <button
                      type="button"
                      className="browseButton"
                      onClick={async () => {
                        const res = await fetch("/api/fs/pick-folder", { method: "POST" });
                        const data = (await res.json()) as { path: string | null };
                        if (data.path) setProjectPath(data.path);
                      }}
                    >
                      <FolderOpen size={14} />
                      浏览
                    </button>
                  </div>
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
            <button
              ref={settingsBtnRef}
              className="iconButton"
              type="button"
              aria-label="项目设置"
              disabled={!selectedProjectId}
              onClick={() => setShowSettings((v) => !v)}
            >
              <Settings size={17} />
            </button>
            <SettingsPopover
              projectId={selectedProjectId}
              open={showSettings}
              onClose={() => setShowSettings(false)}
              triggerRef={settingsBtnRef}
            />
          </div>
        </header>

        <div ref={contentRef} className={taskDetails ? "content taskContent" : "content"}>
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
            task={mergedTaskDetails}
          />
        </div>

        <Composer
          prompt={prompt}
          mode={mode}
          budget={budget}
          permission={permission}
          busy={busy}
          selectedProjectId={selectedProjectId}
          error={error}
          onPromptChange={setPrompt}
          onModeChange={setMode}
          onBudgetChange={setBudget}
          onPermissionChange={setPermission}
          hasSelectedTask={Boolean(taskDetails)}
          onSubmit={taskDetails ? appendTaskMessage : createTask}
        />
      </section>
    </main>
  );
}
