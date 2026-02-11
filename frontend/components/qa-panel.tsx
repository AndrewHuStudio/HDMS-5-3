"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import type { CityElement } from "@/lib/city-data";
import { elementTypeNames } from "@/lib/city-data";
import { useQAPanelStore, type QAPanelMessage } from "@/lib/stores/qa-store";
import { Send, Network, MessageSquare, Plus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = QAPanelMessage;

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
  const [isMounted, setIsMounted] = useState(false);
  const conversations = useQAPanelStore((state) => state.conversations);
  const activeConversationId = useQAPanelStore((state) => state.activeConversationId);
  const createConversation = useQAPanelStore((state) => state.createConversation);
  const switchConversation = useQAPanelStore((state) => state.switchConversation);
  const appendMessage = useQAPanelStore((state) => state.appendMessage);
  const setActiveConversationContextId = useQAPanelStore((state) => state.setActiveConversationContextId);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "graph">("chat");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations]
  );
  const messages = activeConversation?.messages ?? [];
  const lastContextElementId = activeConversation?.lastContextElementId ?? null;

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  );

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  useEffect(() => {
    if (!selectedElement) {
      if (lastContextElementId !== null) {
        setActiveConversationContextId(null);
      }
      return;
    }
    if (selectedElement.id === lastContextElementId) {
      return;
    }
    const systemMessage: Message = {
      id: `context-${selectedElement.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "assistant",
      content: `已切换到【${selectedElement.name}】，这是一个${elementTypeNames[selectedElement.type]}。您可以询问关于它的任何问题。`,
      timestamp: new Date(),
    };
    appendMessage(systemMessage);
    setActiveConversationContextId(selectedElement.id);
  }, [appendMessage, lastContextElementId, selectedElement, setActiveConversationContextId]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    const question = input.trim();

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    appendMessage(userMessage);
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
      appendMessage(assistantMessage);
    } catch (error) {
      const fallback = buildFallbackAnswer(question, selectedElement);
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "assistant",
        content: fallback,
        timestamp: new Date(),
      };
      appendMessage(assistantMessage);
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickQuestion = (question: string) => {
    setInput(question);
  };

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <Select value={activeConversationId} onValueChange={switchConversation}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="选择对话" />
              </SelectTrigger>
              <SelectContent>
                {sortedConversations.map((conversation) => (
                  <SelectItem key={conversation.id} value={conversation.id}>
                    {conversation.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              createConversation();
              setInput("");
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            新建对话
          </Button>
        </div>
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
            <span className="text-xs text-muted-foreground">当前上下文:</span>
            <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded border border-primary/20">
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
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-muted text-foreground"
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
                              <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
                                {children}
                              </code>
                            ) : (
                              <code className="block rounded bg-slate-900 text-slate-100 dark:bg-slate-800 p-3 text-xs overflow-x-auto">
                                {children}
                              </code>
                            ),
                          pre: ({ children }) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
                              {children}
                            </blockquote>
                          ),
                          table: ({ children }) => (
                            <div className="mb-2 overflow-x-auto">
                              <table className="min-w-full border-collapse text-xs">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
                          th: ({ children }) => (
                            <th className="border border-border px-2 py-1 text-left font-semibold">
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="border border-border px-2 py-1 align-top">{children}</td>
                          ),
                          hr: () => <hr className="my-2 border-border" />,
                        }}
                      >
                        {normalizeMarkdownLists(message.content)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  )}
                  <p
                    className={`text-xs mt-1 ${message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                    suppressHydrationWarning
                  >
                    {isMounted
                      ? message.timestamp.toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </p>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex">
                <div className="mr-auto bg-muted rounded-lg px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.3s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 快捷问题 */}
          <div className="px-4 py-2 border-t border-border bg-card">
            <p className="text-xs text-muted-foreground mb-2">快捷提问:</p>
            <div className="flex flex-wrap gap-2">
              {quickQuestions.map((q, index) => (
                <Button
                  key={`quick-${index}`}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => handleQuickQuestion(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>

          {/* 输入框 */}
          <div className="p-4 border-t border-border">
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
                className="flex-1"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
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
