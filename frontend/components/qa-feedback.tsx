"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { submitFeedback } from "@/features/qa/api";

interface QAFeedbackProps {
  messageId: string;
  question: string;
  answer: string;
  currentFeedback?: "useful" | "not_useful";
  onFeedbackChange: (feedback: "useful" | "not_useful") => void;
}

export function QAFeedback({
  messageId,
  question,
  answer,
  currentFeedback,
  onFeedbackChange,
}: QAFeedbackProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleFeedback = async (rating: "useful" | "not_useful") => {
    if (currentFeedback === rating || submitting) return;

    setSubmitting(true);
    try {
      await submitFeedback({
        message_id: messageId,
        question,
        answer,
        rating,
      });
      onFeedbackChange(rating);
    } catch (err) {
      console.warn("Feedback submission failed:", err);
      onFeedbackChange(rating);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1">
      <span className="mr-1 text-[10px] text-muted-foreground">
        {currentFeedback ? "感谢反馈" : "回答有帮助吗?"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 w-6 p-0 ${
          currentFeedback === "useful"
            ? "text-green-600 bg-green-500/10"
            : "text-muted-foreground hover:text-green-600"
        }`}
        onClick={() => handleFeedback("useful")}
        disabled={submitting || currentFeedback === "useful"}
      >
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 w-6 p-0 ${
          currentFeedback === "not_useful"
            ? "text-red-600 bg-red-500/10"
            : "text-muted-foreground hover:text-red-600"
        }`}
        onClick={() => handleFeedback("not_useful")}
        disabled={submitting || currentFeedback === "not_useful"}
      >
        <ThumbsDown className="h-3 w-3" />
      </Button>
    </div>
  );
}
