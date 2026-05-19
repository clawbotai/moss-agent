import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { AgentSkill, TaskMode, TaskSkillSelection } from "@/lib/types";
import { SkillPaletteItem } from "./SkillPaletteItem";

interface SkillPaletteProps {
  skills: AgentSkill[];
  mode: TaskMode;
  skillSelection: TaskSkillSelection;
  onSelectionChange: (selection: TaskSkillSelection) => void;
  onClose: () => void;
  onRefresh: () => void;
  loading: boolean;
}

export function SkillPalette({
  skills,
  mode,
  skillSelection,
  onSelectionChange,
  onClose,
  onRefresh,
  loading,
}: SkillPaletteProps) {
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const modeSkills = useMemo(() => {
    if (mode === "custom") return [];
    if (mode === "codexOnly") return skills.filter((skill) => skill.builtin || skill.agent === "codex" || skill.agent === "both");
    if (mode === "claudeOnly") return skills.filter((skill) => skill.builtin || skill.agent === "claude" || skill.agent === "both");
    return skills;
  }, [mode, skills]);

  // 过滤技能
  const filteredSkills = useMemo(() => modeSkills.filter((skill) => {
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        skill.id.toLowerCase().includes(searchLower) ||
        skill.label.toLowerCase().includes(searchLower) ||
        skill.description?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  }), [modeSkills, search]);

  // 分组
  const groupedSkills = useMemo(() => ({
    builtin: filteredSkills.filter((s) => s.builtin),
    claude: filteredSkills.filter((s) => !s.builtin && (s.agent === "claude" || s.agent === "both")),
    codex: filteredSkills.filter((s) => !s.builtin && s.agent === "codex"),
  }), [filteredSkills]);

  const allGrouped = useMemo(() => [
    ...groupedSkills.builtin,
    ...groupedSkills.claude,
    ...groupedSkills.codex,
  ], [groupedSkills]);

  // 选择/取消选择技能
  const toggleSkill = useCallback((skill: AgentSkill) => {
    const isClaudeSelected = skillSelection.claude.includes(skill.id);
    const isCodexSelected = skillSelection.codex.includes(skill.id);

    let newSelection: TaskSkillSelection;

    if (isClaudeSelected || isCodexSelected) {
      // 取消选择
      newSelection = {
        claude: skillSelection.claude.filter((id) => id !== skill.id),
        codex: skillSelection.codex.filter((id) => id !== skill.id),
      };
    } else {
      // 选择技能
      if (mode === "custom") {
        return;
      }

      if (mode === "codexOnly") {
        if (skill.agent === "claude") return;
        newSelection = {
          claude: [],
          codex: [skill.id],
        };
      } else if (mode === "claudeOnly") {
        if (skill.agent === "codex") return;
        newSelection = {
          claude: [skill.id],
          codex: [],
        };
      } else if (skill.agent === "codex") {
        newSelection = {
          ...skillSelection,
          codex: [skill.id],
        };
      } else if (skill.agent === "claude") {
        newSelection = {
          ...skillSelection,
          claude: [skill.id],
        };
      } else {
        // collaborative + both skill: 默认两者都用
        newSelection = {
          claude: [skill.id],
          codex: [skill.id],
        };
      }
    }

    onSelectionChange(newSelection);
  }, [skillSelection, mode, onSelectionChange]);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, allGrouped.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const skill = allGrouped[highlightIndex];
        if (skill) {
          toggleSkill(skill);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [allGrouped, highlightIndex, onClose, toggleSkill]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // 自动聚焦搜索框
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const isSkillSelected = (skill: AgentSkill) => {
    return skillSelection.claude.includes(skill.id) || skillSelection.codex.includes(skill.id);
  };

  const renderGroup = (title: string, skills: AgentSkill[], startIndex: number) => {
    if (skills.length === 0) return null;

    return (
      <div className="skillPaletteGroup">
        <div className="skillPaletteGroupTitle">{title}</div>
        {skills.map((skill, index) => (
          <SkillPaletteItem
            key={skill.id}
            skill={skill}
            isSelected={isSkillSelected(skill)}
            isHighlighted={startIndex + index === highlightIndex}
            onSelect={toggleSkill}
            onHighlight={() => setHighlightIndex(startIndex + index)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="skillPalette" ref={paletteRef}>
      <div className="skillPaletteHeader">
        <span className="skillPaletteTitle">技能 {modeSkills.filter((s) => !s.builtin).length}</span>
        <button className="skillPaletteRefresh" onClick={onRefresh} disabled={loading}>
          刷新
        </button>
      </div>

      <div className="skillPaletteSearch">
        <input
          ref={searchRef}
          type="text"
          className="skillPaletteSearchInput"
          placeholder="搜索技能..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setHighlightIndex(0);
          }}
        />
      </div>

      <div className="skillPaletteList">
        {loading ? (
          <div className="skillPaletteEmpty">加载中...</div>
        ) : allGrouped.length === 0 ? (
          <div className="skillPaletteEmpty">没有找到匹配的技能</div>
        ) : (
          <>
            {renderGroup("内置命令", groupedSkills.builtin, 0)}
            {renderGroup("Claude 技能", groupedSkills.claude, groupedSkills.builtin.length)}
            {renderGroup("Codex 技能", groupedSkills.codex, groupedSkills.builtin.length + groupedSkills.claude.length)}
          </>
        )}
      </div>
    </div>
  );
}
