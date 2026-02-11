"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { QASources } from "@/components/qa-sources";
import { ThinkingProcess } from "@/components/qa-thinking";
import type { CityElement } from "@/lib/city-data";
import { elementTypeNames } from "@/lib/city-data";
import { useQAPanelStore, type QAPanelMessage } from "@/lib/stores/qa-store";
import { sendQuestion, sendQuestionStream } from "@/features/qa/api";
import type { SourceInfo } from "@/features/qa/types";
import { Send, Network, MessageSquare, Plus, BookOpenText, FileStack, Link2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

type Message = QAPanelMessage;

type MainTab = "chat" | "materials";
type MaterialsTab = "references" | "graph";

interface QAPanelProps {
  selectedElement: CityElement | null;
}

const quickQuestions = [
  "高强度片区的核心管控指标有哪些",
  "这个地块有哪些关键约束条件",
  "请总结当前资料中的主要结论与依据",
  "城市设计管控方案的审查要点是什么",
];

const CITATION_PATTERN = /\[(\d{1,2})\](?!\()/g;

const buildHistory = (messages: Message[]) =>
  messages
    .filter((message) => message.id !== "welcome")
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));

const buildFallbackAnswer = (question: string, element: CityElement | null, detail?: string) => {
  if (element) {
    const intro = `【${element.name}】这是一个${elementTypeNames[element.type]}。`;
    const knowledge = element.knowledgeBase[0] ? `\n\n${element.knowledgeBase[0]}` : "";
    const reason = detail ? `\n\n（提示：在线问答暂时不可用，原因：${detail}）` : "";
    return `${intro}${knowledge}${reason}`;
  }

  const suffix = detail ? `\n\n请求失败原因：${detail}` : "";

  if (question.includes("图谱") || question.includes("关系")) {
    return `当前接口不可用，已启用本地简答。您可以继续提问知识图谱关系、资料证据与结论依据。${suffix}`;
  }
  return `当前接口不可用，已启用本地简答。您可以提问资料内容、地块指标关系与管控审查结论。${suffix}`;
};

const injectCitationAnchors = (content: string, sourceCount: number) => {
  if (!content || sourceCount <= 0) return content;
  return content.replace(CITATION_PATTERN, (raw, value) => {
    const index = Number.parseInt(value, 10);
    if (Number.isNaN(index) || index < 1 || index > sourceCount) {
      return raw;
    }
    return `[${index}](#source-${index})`;
  });
};

const parseCitationIndex = (href?: string): number | null => {
  if (!href) return null;
  const match = href.match(/^#source-(\d+)$/);
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  return Number.isNaN(index) ? null : index;
};

/** Resolve image src: convert relative /rag/... paths to absolute URLs */
const resolveImageSrc = (src: string): string => {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  const base = normalizeApiBase(API_BASE);
  return src.startsWith("/") ? `${base}${src}` : `${base}/${src}`;
};

/** Extract recommended questions from <!--RECOMMENDED_QUESTIONS ... --> block */
const extractRecommendedQuestions = (content: string): {
  cleanContent: string;
  questions: string[];
} => {
  const pattern = /<!--RECOMMENDED_QUESTIONS\s*\n([\s\S]*?)-->/;
  const match = content.match(pattern);
  if (!match) return { cleanContent: content, questions: [] };

  const questions = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cleanContent = content.replace(pattern, "").trimEnd();
  return { cleanContent, questions };
};

const getReferencedCitationCount = (content: string, sourceCount: number) => {
  if (!content || sourceCount <= 0) return 0;

  const matches = content.match(/\[(\d{1,2})\]/g) || [];
  const unique = new Set<number>();
  for (const token of matches) {
    const raw = token.slice(1, -1);
    const idx = Number.parseInt(raw, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= sourceCount) {
      unique.add(idx);
    }
  }

  return unique.size;
};

const normalizeMarkdownLists = (content: string) => {
  const lines = content.split(/\r?\n/);
  let activeIndent = "";
  let orderedCounter = 0;

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      const sectionBreak =
        /^#{1,6}\s+/.test(trimmed) ||
        /^[-*_]{3,}$/.test(trimmed) ||
        /^\*\*.+\*\*$/.test(trimmed);
      if (sectionBreak) {
        orderedCounter = 0;
        activeIndent = "";
      }

      const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
      if (orderedMatch) {
        const indent = orderedMatch[1] ?? "";
        const body = orderedMatch[2] ?? "";

        if (indent === activeIndent && orderedCounter > 0) {
          orderedCounter += 1;
        } else {
          orderedCounter = 1;
          activeIndent = indent;
        }

        return `${indent}${orderedCounter}. ${body}`;
      }

      const bulletMatch = line.match(/^(\s*)[-*+]\s+/);
      if (bulletMatch) {
        const bulletIndent = bulletMatch[1] ?? "";
        if (orderedCounter > 0 && bulletIndent.length <= activeIndent.length) {
          const normalized = line.trimStart();
          return `${activeIndent}  ${normalized}`;
        }

        return line;
      }

      if (/^\S/.test(line)) {
        orderedCounter = 0;
        activeIndent = "";
      }

      return line;
    })
    .join("\n");
};

const getMessageTitle = (content: string) => {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "未命名回答";
  return compact.length > 26 ? `${compact.slice(0, 26)}...` : compact;
};

const findPrecedingQuestion = (messages: Message[], messageId: string) => {
  const idx = messages.findIndex((message) => message.id === messageId);
  if (idx <= 0) return undefined;

  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }
  return undefined;
};

export function QAPanel({ selectedElement }: QAPanelProps) {
  const [isMounted, setIsMounted] = useState(false);
  const conversations = useQAPanelStore((state) => state.conversations);
  const activeConversationId = useQAPanelStore((state) => state.activeConversationId);
  const createConversation = useQAPanelStore((state) => state.createConversation);
  const switchConversation = useQAPanelStore((state) => state.switchConversation);
  const appendMessage = useQAPanelStore((state) => state.appendMessage);
  const updateMessage = useQAPanelStore((state) => state.updateMessage);
  const setActiveConversationContextId = useQAPanelStore((state) => state.setActiveConversationContextId);

  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>("chat");
  const [materialsTab, setMaterialsTab] = useState<MaterialsTab>("references");
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const [activeSourceMessageId, setActiveSourceMessageId] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

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

  const sourceHostMessages = useMemo(
    () => messages.filter((message) => message.role === "assistant" && (message.sources?.length ?? 0) > 0),
    [messages]
  );

  const latestSourceMessage = sourceHostMessages[sourceHostMessages.length - 1] ?? null;

  const activeSourceMessage = useMemo(() => {
    if (!sourceHostMessages.length) return null;
    const matched = sourceHostMessages.find((message) => message.id === activeSourceMessageId);
    return matched ?? latestSourceMessage;
  }, [activeSourceMessageId, latestSourceMessage, sourceHostMessages]);

  const activeSourceQuestion = useMemo(
    () => (activeSourceMessage ? findPrecedingQuestion(messages, activeSourceMessage.id) : undefined),
    [activeSourceMessage, messages]
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
      id: `context-${selectedElement.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: "assistant",
      content: `已切换到【${selectedElement.name}】，这是一个${elementTypeNames[selectedElement.type]}。您可以询问关于它的管控指标与设计要求。`,
      timestamp: new Date(),
    };
    appendMessage(systemMessage);
    setActiveConversationContextId(selectedElement.id);
  }, [appendMessage, lastContextElementId, selectedElement, setActiveConversationContextId]);

  useEffect(() => {
    if (!sourceHostMessages.length) {
      setActiveSourceMessageId(null);
      setActiveCitation(null);
      return;
    }

    if (!activeSourceMessageId || !sourceHostMessages.some((message) => message.id === activeSourceMessageId)) {
      setActiveSourceMessageId(sourceHostMessages[sourceHostMessages.length - 1].id);
    }
  }, [activeSourceMessageId, sourceHostMessages]);

  useEffect(() => {
    setActiveCitation(null);
  }, [activeSourceMessageId]);

  const handleSend = async (directQuestion?: string) => {
    const question = directQuestion?.trim() || input.trim();
    if (!question || isTyping) return;

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    appendMessage(userMessage);
    setInput("");
    setIsTyping(true);

    const assistantId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    appendMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      thinking: "",
      sources: [],
      isStreaming: true,
      timestamp: new Date(),
    });

    const history = buildHistory([...messages, userMessage]);

    try {
      await sendQuestionStream(
        question,
        history,
        {
          onSources: (sources) => {
            updateMessage(assistantId, (message) => ({ ...message, sources }));
            if (sources.length > 0) {
              setActiveSourceMessageId(assistantId);
            }
          },
          onRetrievalStats: (stats) => {
            updateMessage(assistantId, (message) => ({ ...message, retrievalStats: stats }));
          },
          onGraph: () => {
            // qa-panel does not display inline subgraph; handled by qa-view only
          },
          onStatus: () => undefined,
          onThinking: (token) => {
            updateMessage(assistantId, (message) => ({
              ...message,
              thinking: (message.thinking || "") + token,
            }));
          },
          onAnswer: (token) => {
            updateMessage(assistantId, (message) => ({
              ...message,
              content: message.content + token,
            }));
          },
          onDone: () => {
            updateMessage(assistantId, (message) => ({
              ...message,
              isStreaming: false,
              statusMessage: undefined,
              content: message.content.trim() ? message.content : "未返回答案。",
            }));
          },
          onError: (detail) => {
            updateMessage(assistantId, (message) => ({
              ...message,
              isStreaming: false,
              statusMessage: undefined,
              content: message.content || `请求失败：${detail}`,
            }));
          },
        }
      );
    } catch {
      try {
        const response = await sendQuestion(question, history);
        updateMessage(assistantId, (message) => ({
          ...message,
          content: (response.answer || "未返回答案。").trim(),
          sources: response.sources || [],
          isStreaming: false,
        }));
        if ((response.sources || []).length > 0) {
          setActiveSourceMessageId(assistantId);
        }
      } catch (fallbackError) {
        const detail =
          fallbackError instanceof Error ? fallbackError.message : "请求失败";
        const fallback = buildFallbackAnswer(question, selectedElement, detail);
        updateMessage(assistantId, (message) => ({
          ...message,
          content: fallback,
          isStreaming: false,
        }));
      }
    } finally {
      setIsTyping(false);
    }
  };

  const handleCitationSelect = (messageId: string, citation: number) => {
    setActiveSourceMessageId(messageId);
    setActiveCitation(citation);
    setMaterialsTab("references");
    setActiveTab("materials");
  };


  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col border-b border-border bg-card px-4 py-2">
        <div className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
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
            <Plus className="mr-1 h-3 w-3" />
            新建对话
          </Button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as MainTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              智能问答
            </TabsTrigger>
            <TabsTrigger value="materials" className="flex items-center gap-2">
              <BookOpenText className="h-4 w-4" />
              资料卡片
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div ref={scrollContainerRef} className="qa-scrollbar h-full space-y-3 overflow-y-scroll px-4 py-4">
              {messages.map((message) => {
                const isAssistant = message.role === "assistant";
                const sourceCount = message.sources?.length ?? 0;
                const referencedCount = getReferencedCitationCount(message.content, sourceCount);
                const isSourceMessage =
                  isAssistant &&
                  sourceCount > 0 &&
                  referencedCount > 0 &&
                  Boolean(message.content.trim()) &&
                  !message.isStreaming;

                return (
                  <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={cn(
                        "max-w-[92%] rounded-lg px-4 py-3",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      )}
                    >
                      {isAssistant ? (
                        <AssistantMessageBlock
                          message={message}
                          onCitationSelect={(citation) => handleCitationSelect(message.id, citation)}
                          onFillInput={setInput}
                          onImageClick={setLightboxSrc}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                      )}

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p
                          className={`text-xs ${message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                          suppressHydrationWarning
                        >
                          {isMounted
                            ? message.timestamp.toLocaleTimeString("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : ""}
                        </p>

                        {isSourceMessage && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-card"
                            onClick={() => {
                              setActiveSourceMessageId(message.id);
                              setMaterialsTab("references");
                              setActiveTab("materials");
                            }}
                          >
                            <Link2 className="h-3 w-3" />
                            引用 {sourceCount}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

            </div>

            {!messages.some((m) => m.role === "user") && (
              <div className="border-t border-border bg-card px-4 py-2">
                <p className="mb-2 text-xs text-muted-foreground">快捷提问:</p>
                <div className="flex flex-wrap gap-2">
                  {quickQuestions.map((question, index) => (
                    <Button
                      key={`quick-${index}`}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setInput(question)}
                    >
                      {question}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-border p-4">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSend();
                }}
                className="flex gap-2"
              >
                <Input
                  placeholder="输入您的问题..."
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || isTyping}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </TabsContent>

          <TabsContent value="materials" className="qa-scrollbar m-0 flex-1 min-h-0 overflow-y-scroll p-4">
            <Tabs
              value={materialsTab}
              onValueChange={(value) => setMaterialsTab(value as MaterialsTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="mb-3 grid w-full grid-cols-2">
                <TabsTrigger value="references" className="flex items-center gap-1.5">
                  <FileStack className="h-3.5 w-3.5" />
                  参考资料
                </TabsTrigger>
                <TabsTrigger value="graph" className="flex items-center gap-1.5">
                  <Network className="h-3.5 w-3.5" />
                  知识图谱
                </TabsTrigger>
              </TabsList>

              <TabsContent value="references" className="m-0 space-y-3">
                {sourceHostMessages.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                    当前回答还没有可引用的资料。您可以先提问一次，系统会把 [1][2] 对应的证据展示在这里。
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">关联回答</p>
                      <Select
                        value={activeSourceMessage?.id ?? sourceHostMessages[sourceHostMessages.length - 1].id}
                        onValueChange={(value) => setActiveSourceMessageId(value)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="选择回答" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceHostMessages.map((message) => (
                            <SelectItem key={message.id} value={message.id}>
                              {getMessageTitle(message.content)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {activeSourceMessage && (
                      <QASources
                        sources={activeSourceMessage.sources || []}
                        query={activeSourceQuestion}
                        activeCitation={activeCitation}
                        onCitationHover={setActiveCitation}
                        onCitationSelect={setActiveCitation}
                        layout="inline"
                      />
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="graph" className="m-0">
                <KnowledgeGraph subgraph={null} />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>

      {/* Image lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt="放大查看"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function AssistantMessageBlock({
  message,
  onCitationSelect,
  onFillInput,
  onImageClick,
}: {
  message: Message;
  onCitationSelect: (citation: number) => void;
  onFillInput?: (value: string) => void;
  onImageClick?: (src: string) => void;
}) {
  const sourceCount = message.sources?.length ?? 0;

  const { cleanContent, questions: recommendedQuestions } = useMemo(
    () => (message.isStreaming ? { cleanContent: message.content, questions: [] } : extractRecommendedQuestions(message.content)),
    [message.content, message.isStreaming]
  );

  const answerContent = useMemo(() => {
    const baseContent = injectCitationAnchors(
      normalizeMarkdownLists(cleanContent),
      sourceCount
    );
    return baseContent;
  }, [cleanContent, sourceCount]);

  const thinkingText = message.thinking?.trim() ?? "";

  return (
    <div className="space-y-2">
      {(message.isStreaming || thinkingText) && (
        <ThinkingProcess thinking={thinkingText} isStreaming={Boolean(message.isStreaming)} statusMessage={message.statusMessage} />
      )}

      {message.content ? (
        <div className="qa-markdown prose prose-sm max-w-none break-words [overflow-wrap:anywhere] dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 break-words [overflow-wrap:anywhere] last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
              li: ({ children }) => <li className="mb-1 break-words [overflow-wrap:anywhere] last:mb-0">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <code className={`${className ?? ""} block overflow-x-auto rounded bg-card p-2 text-xs`}>
                    {children}
                  </code>
                ) : (
                  <code className="rounded bg-card px-1 py-0.5 text-xs">{children}</code>
                );
              },
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
                <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
              ),
              td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
              hr: () => <hr className="my-2 border-border" />,
              img: ({ src, alt }) => {
                const resolved = resolveImageSrc(typeof src === "string" ? src : "");
                return (
                  <img
                    src={resolved}
                    alt={alt ?? "参考图片"}
                    className="my-2 max-h-60 cursor-zoom-in rounded border border-border object-contain transition-opacity hover:opacity-80"
                    loading="lazy"
                    onClick={() => onImageClick?.(resolved)}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                );
              },
              a: ({ href, children }) => {
                const citationIndex = parseCitationIndex(href);
                if (!citationIndex) {
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
                      {children}
                    </a>
                  );
                }

                return (
                  <CitationBadge
                    citation={citationIndex}
                    source={message.sources?.[citationIndex - 1]}
                    onClick={onCitationSelect}
                  >
                    {children}
                  </CitationBadge>
                );
              },
            }}
          >
            {answerContent}
          </ReactMarkdown>
        </div>
      ) : null}

      {/* Recommended questions - subtle inline chips */}
      {!message.isStreaming && recommendedQuestions.length > 0 && (
        <div className="mt-2 pt-2">
          <p className="mb-1.5 text-[11px] text-muted-foreground">您可能还想了解：</p>
          <div className="flex flex-wrap gap-1.5">
            {recommendedQuestions.map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-md border border-border/50 bg-card/80 px-2.5 py-0.5 text-[11px] text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:text-foreground hover:shadow"
                onClick={() => onFillInput?.(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CitationBadge({
  citation,
  source,
  onClick,
  children,
}: {
  citation: number;
  source?: SourceInfo;
  onClick: (citation: number) => void;
  children: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onClick(citation);
    // Flash the corresponding source card in the materials tab
    setTimeout(() => {
      const target = document.getElementById(`source-${citation}`);
      if (target) {
        target.classList.add("qa-source-flash");
        setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
      }
    }, 100);
  };

  const titleText = source?.name
    ? `${source.name}${source.section ? " - " + source.section : ""}`
    : `引用 [${citation}]`;

  return (
    <a
      href={`#source-${citation}`}
      title={titleText}
      className="inline-flex min-h-5 items-center rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary no-underline transition-colors hover:bg-primary/20"
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

