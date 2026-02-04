"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import type { CityElement } from "@/lib/city-data";
import { elementTypeNames } from "@/lib/city-data";
import { Send, Network, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface QAPanelProps {
  selectedElement: CityElement | null;
}

const quickQuestions = [
  "城市管控要素有哪些",
  "限高控制有什么要求",
  "容积率如何影响开发强度",
  "系统能提供哪些价值",
];

const CHAT_ENDPOINT = "/qa/chat";

const buildHistory = (messages: Message[]) =>
  messages
    .filter((message) => message.id !== "welcome")
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));

const buildFallbackAnswer = (question: string, element: CityElement | null) => {
  if (element) {
    const intro = `【${element.name}】这是一个${elementTypeNames[element.type]}。`;
    const knowledge = element.knowledgeBase[0] ? `\n\n${element.knowledgeBase[0]}` : "";
    return `${intro}${knowledge}`;
  }

  if (question.includes("图谱") || question.includes("关系")) {
    return "当前接口不可用，已启用本地简答。你可以继续提问管控要素、指标与关系。";
  }
  return "当前接口不可用，已启用本地简答。你可以提问限高、退线、容积率、日照等管控问题。";
};

const normalizeMarkdownLists = (content: string) => {
  const lines = content.split(/\r?\n/);
  let lastNonEmptyLine = "";
  let lastIndent = "";

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      const orderedMatch = line.match(/^(\s*)\d+\.\s+/);
      if (orderedMatch) {
        lastNonEmptyLine = "ordered";
        lastIndent = orderedMatch[1] ?? "";
        return line;
      }

      const bulletMatch = line.match(/^(\s*)[-*+]\s+/);
      if (bulletMatch && lastNonEmptyLine === "ordered") {
        const normalized = line.trimStart();
        return `${lastIndent}  ${normalized}`;
      }

      lastNonEmptyLine = "other";
      return line;
    })
    .join("\n");
};

export function QAPanel({ selectedElement }: QAPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "您好！我是城市管控助手。您可以直接提问城市管控相关问题，我会结合知识库与您后续上传的资料生成图文并茂的答案，并提供关键指标解读与调整建议。",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "graph">("chat");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  useEffect(() => {
    if (selectedElement) {
      const systemMessage: Message = {
        id: `context-${selectedElement.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "assistant",
        content: `已切换到【${selectedElement.name}】，这是一个${elementTypeNames[selectedElement.type]}。您可以询问关于它的任何问题。`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, systemMessage]);
    }
  }, [selectedElement]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    const question = input.trim();

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          history: buildHistory(messages),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `请求失败: ${response.status}`);
      }

      const data = (await response.json()) as { answer?: string };
      const aiResponse = data.answer?.trim() || "未返回答案。";
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "assistant",
        content: aiResponse,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const fallback = buildFallbackAnswer(question, selectedElement);
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "assistant",
        content: fallback,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickQuestion = (question: string) => {
    setInput(question);
  };

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "chat" | "graph")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              智能问答
            </TabsTrigger>
            <TabsTrigger value="graph" className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              知识图谱
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {selectedElement && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-slate-500">当前上下文:</span>
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200">
              {selectedElement.name}
            </span>
          </div>
        )}
      </div>

      {/* 标签页内容 */}
      <Tabs value={activeTab} className="flex-1 flex flex-col min-h-0">
        {/* 智能问答标签页 */}
        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 m-0">
          {/* 消息列表 */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-4"
            style={{ minHeight: 0 }}
          >
            {messages.map((message) => (
              <div key={message.id} className="flex">
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === "user"
                    ? "ml-auto bg-blue-500 text-white"
                    : "mr-auto bg-slate-100 text-slate-800"
                }`}
              >
                  {message.role === "assistant" ? (
                    <div className="text-sm leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
                          li: ({ children }) => <li className="mb-1 last:mb-0">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                          code: ({
                            inline,
                            children,
                          }: {
                            inline?: boolean;
                            children?: ReactNode;
                          }) =>
                            inline ? (
                              <code className="rounded bg-slate-200/60 px-1 py-0.5 text-[0.85em]">
                                {children}
                              </code>
                            ) : (
                              <code className="block rounded bg-slate-900 text-slate-100 p-3 text-xs overflow-x-auto">
                                {children}
                              </code>
                            ),
                          pre: ({ children }) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-2 border-slate-300 pl-3 text-slate-600">
                              {children}
                            </blockquote>
                          ),
                          table: ({ children }) => (
                            <div className="mb-2 overflow-x-auto">
                              <table className="min-w-full border-collapse text-xs">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-slate-200/60">{children}</thead>,
                          th: ({ children }) => (
                            <th className="border border-slate-300 px-2 py-1 text-left font-semibold">
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="border border-slate-300 px-2 py-1 align-top">{children}</td>
                          ),
                          hr: () => <hr className="my-2 border-slate-300" />,
                        }}
                      >
                        {normalizeMarkdownLists(message.content)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  )}
                  <p className={`text-xs mt-1 ${message.role === "user" ? "text-blue-100" : "text-slate-400"}`}>
                    {message.timestamp.toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex">
                <div className="mr-auto bg-slate-100 rounded-lg px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 快捷问题 */}
          <div className="px-4 py-2 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500 mb-2">快捷提问:</p>
            <div className="flex flex-wrap gap-2">
              {quickQuestions.map((q, index) => (
                <Button
                  key={`quick-${index}`}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 bg-white hover:bg-slate-100 text-slate-600 border-slate-200"
                  onClick={() => handleQuickQuestion(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>

          {/* 输入框 */}
          <div className="p-4 border-t border-slate-200">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="输入您的问题..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 bg-white border-slate-200 focus:border-blue-300"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim()}
                className="bg-blue-500 hover:bg-blue-600 text-white"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </TabsContent>

        {/* 知识图谱标签页 */}
        <TabsContent value="graph" className="flex-1 overflow-auto p-4 m-0">
          <KnowledgeGraph selectedElement={selectedElement} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
