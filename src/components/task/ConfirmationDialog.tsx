"use client";

import { useState, useCallback } from "react";
import { HelpCircle } from "lucide-react";
import type { AgentConfirmationRequest } from "@/lib/agents/types";

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
  const [customInput, setCustomInput] = useState("");
  const options = confirmationRequest.options;
  const hasOptions = options && options.length > 0;

  const handleSubmit = useCallback(() => {
    if (isSubmitting) return;

    let response: string;
    if (options && selectedOption !== null) {
      response = options[selectedOption];
    } else if (customInput.trim()) {
      response = customInput.trim();
    } else {
      return;
    }

    onConfirm(response);
  }, [options, selectedOption, customInput, onConfirm, isSubmitting]);

  return (
    <div className="confirmationPanel">
      <div className="confirmationHeader">
        <HelpCircle size={16} />
        <span>需要确认</span>
      </div>

      <div className="confirmationQuestion">
        {confirmationRequest.question}
      </div>

      <div className="confirmationBody">
        {hasOptions ? (
          <div className="confirmationOptions">
            {options.map((option, index) => (
              <label
                key={index}
                className={`confirmationOption ${selectedOption === index ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="confirmation-option"
                  checked={selectedOption === index}
                  onChange={() => setSelectedOption(index)}
                  disabled={isSubmitting}
                />
                <span className="confirmationOptionText">{option}</span>
              </label>
            ))}
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
          disabled={isSubmitting || (hasOptions ? selectedOption === null : !customInput.trim())}
        >
          {isSubmitting ? "提交中..." : "确认"}
        </button>
      </div>
    </div>
  );
}
