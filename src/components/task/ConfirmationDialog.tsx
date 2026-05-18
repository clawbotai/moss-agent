"use client";

import { useState, useCallback } from "react";
import { HelpCircle, ChevronDown } from "lucide-react";
import type { AgentConfirmationRequest } from "@/lib/agents/types";
import { MarkdownBlock } from "./MarkdownBlock";

interface ConfirmationDialogProps {
  confirmationRequest: AgentConfirmationRequest;
  onConfirm: (response: string) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function ConfirmationDialog({
  confirmationRequest,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: ConfirmationDialogProps) {
  const [selectedOption, setSelectedOption] = useState<number | null>(
    confirmationRequest.defaultOption ?? null
  );
  const [useCustomInput, setUseCustomInput] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const options = confirmationRequest.options;
  const hasOptions = options && options.length > 0;
  const hasContext = confirmationRequest.rawOutput
    && confirmationRequest.rawOutput.trim() !== confirmationRequest.question.trim();

  const handleSelectOption = useCallback((index: number) => {
    setSelectedOption(index);
    setUseCustomInput(false);
  }, []);

  const handleSelectCustom = useCallback(() => {
    setUseCustomInput(true);
    setSelectedOption(null);
  }, []);

  const canSubmit = useCustomInput
    ? customInput.trim().length > 0
    : selectedOption !== null;

  const handleSubmit = useCallback(() => {
    if (isSubmitting) return;

    let response: string;
    if (useCustomInput) {
      response = customInput.trim();
      if (!response) return;
    } else if (options && selectedOption !== null) {
      response = options[selectedOption];
    } else {
      return;
    }

    onConfirm(response);
  }, [options, selectedOption, useCustomInput, customInput, onConfirm, isSubmitting]);

  return (
    <div className="confirmationPanel">
      <div className="confirmationHeader">
        <HelpCircle size={16} />
        <span>需要确认</span>
      </div>

      {hasContext && (
        <details className="confirmationContext">
          <summary>
            <ChevronDown size={12} />
            <span>查看 agent 提问详情</span>
          </summary>
          <div className="confirmationContextBody">
            <MarkdownBlock content={confirmationRequest.rawOutput!} />
          </div>
        </details>
      )}

      <div className="confirmationQuestion">
        {confirmationRequest.question}
      </div>

      <div className="confirmationBody">
        {hasOptions ? (
          <div className="confirmationOptions">
            {options.map((option, index) => (
              <label
                key={`${index}-${option.slice(0, 20)}`}
                className={`confirmationOption ${!useCustomInput && selectedOption === index ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="confirmation-option"
                  checked={!useCustomInput && selectedOption === index}
                  onChange={() => handleSelectOption(index)}
                  disabled={isSubmitting}
                />
                <span className="confirmationOptionText">{option}</span>
              </label>
            ))}
            <label
              className={`confirmationOption ${useCustomInput ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="confirmation-option"
                checked={useCustomInput}
                onChange={handleSelectCustom}
                disabled={isSubmitting}
              />
              <span className="confirmationOptionText">自定义回复...</span>
            </label>
            {useCustomInput && (
              <div className="confirmationInput">
                <textarea
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="请输入您的自定义回复..."
                  disabled={isSubmitting}
                  rows={3}
                  maxLength={4000}
                  autoFocus
                />
              </div>
            )}
          </div>
        ) : (
          <div className="confirmationInput">
            <textarea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="请输入您的回复..."
              disabled={isSubmitting}
              rows={3}
              maxLength={4000}
            />
          </div>
        )}
      </div>

      <div className="confirmationActions">
        <button
          className="confirmationBtn confirmationBtnCancel"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          取消
        </button>
        <button
          className="confirmationBtn confirmationBtnConfirm"
          onClick={handleSubmit}
          disabled={isSubmitting || !canSubmit}
        >
          {isSubmitting ? "提交中..." : "确认"}
        </button>
      </div>
    </div>
  );
}
