"use client";

import { Search } from "lucide-react";
import type { Task } from "@/lib/types";
import { StatusDot, statusLabel } from "@/components/common/StatusDot";
import { BrandLogo } from "@/components/common/BrandLogo";

interface ProjectSidebarProps {
  tasks: Task[];
  selectedProjectId: string;
  selectedTaskId: string;
  filter: string;
  onSelectTask: (taskId: string) => void;
  onFilterChange: (filter: string) => void;
}

export function ProjectSidebar({
  tasks,
  selectedProjectId,
  selectedTaskId,
  filter,
  onSelectTask,
  onFilterChange,
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
          <BrandLogo size={42} decorative />
        </div>
        <div>
          <strong>Moss Agent</strong>
          <span>本地协作调度</span>
        </div>
      </div>

      <div className="searchBox">
        <Search size={15} />
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="搜索任务..."
        />
      </div>

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
