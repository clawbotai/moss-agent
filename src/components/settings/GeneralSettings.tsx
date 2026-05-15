"use client";

interface GeneralSettingsProps {
  projectId: string;
}

export function GeneralSettings({ projectId: _projectId }: GeneralSettingsProps) {
  return (
    <div className="settingsModule">
      <div className="settingsModuleHeader">
        <span className="settingsModuleIcon">⚙️</span>
        <span>通用设置</span>
      </div>

      <div className="settingsPlaceholder">
        <p>通用模块开发中...</p>
        <p className="settingsPlaceholderHint">后续将支持外观、Agent 行为、上下文来源等配置</p>
      </div>
    </div>
  );
}
