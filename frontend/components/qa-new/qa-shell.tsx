"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import type { ChatMessage } from "@/features/qa/types";

interface QAShellProps {
  title?: string;
  subtitle?: string;
  messages: ChatMessage[];
  input: string;
  isSending?: boolean;
  quickQuestions?: string[];
  onInputChange: (value: string) => void;
  onSend: (question?: string) => void;
}

export function QAShell({
  title = "HDMS 问答",
  subtitle = "基于上传资料的智能问答",
  messages,
  input,
  isSending = false,
  quickQuestions = [],
  onInputChange,
  onSend,
}: QAShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isSending]);

  const canSend = !isSending && input.trim().length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-slate-100 text-slate-800"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                <p
                  className={`mt-1 text-[11px] ${
                    message.role === "user" ? "text-blue-100" : "text-slate-400"
                  }`}
                >
                  {message.createdAt}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {quickQuestions.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {quickQuestions.map((question) => (
              <Button
                key={question}
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => onSend(question)}
                disabled={isSending}
              >
                {question}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 bg-white px-6 py-4">
        <div className="flex gap-3">
          <Textarea
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题，按 Enter 发送，Shift+Enter 换行"
            className="min-h-[56px] resize-none"
          />
          <Button
            onClick={() => onSend()}
            disabled={!canSend}
            className="h-[56px] px-4"
          >
            <Send className="mr-2 h-4 w-4" />
            {isSending ? "发送中" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}