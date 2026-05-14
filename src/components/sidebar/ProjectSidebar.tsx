"use client";

import { Folder, Search, TerminalSquare } from "lucide-react";
import type { FormEvent } from "react";
import type { Project, Task } from "@/lib/types";
import { StatusDot, statusLabel } from "@/components/common/StatusDot";

interface ProjectSidebarProps {
  projects: Project[];
  tasks: Task[];
  selectedProjectId: string;
  selectedTaskId: string;
  filter: string;
  busy: boolean;
  projectPath: string;
  projectName: string;
  onSelectProject: (projectId: string) => void;
  onSelectTask: (taskId: string) => void;
  onFilterChange: (filter: string) => void;
  onProjectPathChange: (path: string) => void;
  onProjectNameChange: (name: string) => void;
  onCreateProject: (event: FormEvent) => void;
}

export function ProjectSidebar({
  projects,
  tasks,
  selectedProjectId,
  selectedTaskId,
  filter,
  busy,
  projectPath,
  projectName,
  onSelectProject,
  onSelectTask,
  onFilterChange,
  onProjectPathChange,
  onProjectNameChange,
  onCreateProject,
}: ProjectSidebarProps) {
  const filteredTasks = tasks.filter((task) => {
    const inProject = selectedProjectId ? task.projectId === selectedProjectId : true;
    const keyword = filter.trim().toLowerCase();
    const inSearch = keyword
      ? `${task.title} ${task.prompt} ${task.status}`.toLowerCase().includes(keyword)
      : true;
    return inProject && inSearch;
  });

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark">
          <TerminalSquare size={20} />
        </div>
        <div>
          <strong>Moss Agent</strong>
          <span>本地协作调度</span>
        </div>
      </div>

      <form className="projectForm" onSubmit={onCreateProject}>
        <label>项目目录</label>
        <input
          value={projectPath}
          onChange={(event) => onProjectPathChange(event.target.value)}
          placeholder="/Users/name/project"
        />
        <input
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
          placeholder="项目名，可选"
        />
        <button disabled={busy || !projectPath.trim()} type="submit">
          <Folder size={15} />
          添加项目
        </button>
      </form>

      <div className="searchBox">
        <Search size={15} />
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="搜索任务..."
        />
      </div>

      <section className="projectList">
        <div className="sectionTitle">项目</div>
        {projects.map((project) => (
          <button
            key={project.id}
            className={project.id === selectedProjectId ? "projectItem active" : "projectItem"}
            onClick={() => onSelectProject(project.id)}
            type="button"
          >
            <Folder size={15} />
            <span>{project.name}</span>
          </button>
        ))}
        {projects.length === 0 && <p className="muted">先添加一个本机项目目录。</p>}
      </section>

      <section className="taskList">
        <div className="sectionTitle">任务</div>
        {filteredTasks.map((task) => (
          <button
            key={task.id}
            className={task.id === selectedTaskId ? "taskItem active" : "taskItem"}
            onClick={() => onSelectTask(task.id)}
            type="button"
          >
            <StatusDot status={task.status} />
            <span>{task.title}</span>
            <small>{statusLabel(task.status)}</small>
          </button>
        ))}
        {filteredTasks.length === 0 && <p className="muted">暂无任务。</p>}
      </section>
    </aside>
  );
}
