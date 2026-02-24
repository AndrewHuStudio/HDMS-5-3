"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { QASources } from "@/components/qa-sources";
import type { SourcePreview } from "@/components/qa-sources";
import { PdfLightbox } from "@/components/pdf-lightbox";
import { ThinkingProcess } from "@/components/qa-thinking";
import type { CityElement } from "@/lib/city-data";
import { elementTypeNames } from "@/lib/city-data";
import { useQAPanelStore, type QAPanelMessage } from "@/lib/stores/qa-store";
import { sendQuestion, sendQuestionStream } from "@/features/qa/api";
import type { SourceInfo } from "@/features/qa/types";
import { Send, Network, MessageSquare, Plus, BookOpenText, FileStack, Link2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import { API_BASE, QA_API_BASE, normalizeApiBase } from "@/lib/api-base";
import { injectSourceImages } from "@/lib/inject-source-images";
import { injectSourceTables } from "@/lib/inject-source-tables";
import { normalizeAnswerTables } from "@/lib/normalize-answer-tables";
import { normalizeAnswerMarkdownArtifacts } from "@/lib/normalize-answer-markdown-artifacts";
import { QA_REMARK_PLUGINS } from "@/lib/qa-markdown-plugins";
import { resolvePdfUrlForSource } from "@/lib/resolve-pdf-url";
import { resolvePdfSearchKeyword } from "@/lib/pdf-auto-highlight";
import { prefetchSourcePreviews } from "@/lib/prefetch-source-previews";
import { getSourcePreviewCacheKey } from "@/lib/source-preview-cache";
import { sanitizeAnswerCitations } from "@/lib/sanitize-answer-citations";
import { normalizeCitationSources } from "@/lib/normalize-citation-sources";
import { countReferencedCitations } from "@/lib/align-sources-to-answer";
import { stripInlineCitationLabels } from "@/lib/strip-inline-citation-labels";
import { collapseFigureMentions, mergeStreamingSources } from "@/lib/stream-source-utils";

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

const RETRIEVAL_DOC_NAME_PATTERN = /([A-Za-z0-9\u4e00-\u9fff_\-（）()《》【】·、]+\.pdf)/giu;

function highlightRetrievalDocNames(node: ReactNode, keyPrefix = "doc"): ReactNode {
  if (typeof node === "string") {
    const parts: ReactNode[] = [];
    let last = 0;
    let index = 0;
    RETRIEVAL_DOC_NAME_PATTERN.lastIndex = 0;
    for (const match of node.matchAll(RETRIEVAL_DOC_NAME_PATTERN)) {
      const start = match.index ?? 0;
      const full = match[0];
      if (start > last) parts.push(node.slice(last, start));
      parts.push(
        <span key={`${keyPrefix}-${index}`} className="italic text-sky-600/80">
          {full}
        </span>
      );
      last = start + full.length;
      index += 1;
    }
    if (last === 0) return node;
    if (last < node.length) parts.push(node.slice(last));
    return parts;
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => highlightRetrievalDocNames(child, `${keyPrefix}-${idx}`));
  }
  return node;
}

/**
 * Post-process LLM output to normalize citation placement (N-M format):
 * 1. Move citations before punctuation: "内容。[1-1]" → "内容[1-1]。"
 * 2. Strip citations inside markdown table rows
 * 3. If sources exist but no citations found, append a summary line
 */
const normalizeCitations = (text: string, sources: SourceInfo[]): string => {
  if (!text) return text;

  let result = text;
  const validLabels = new Set(sources.map((s) => s.citation_label).filter((v): v is string => Boolean(v)));

  result = result.replace(
    /([。！？.!?])(\s*(?:\[\d{1,2}-\d{1,2}\])+)/g,
    (_, punct, cites) => `${cites.trim()}${punct}`
  );

  result = result.replace(
    /^(\|.+)$/gm,
    (line) => line.replace(/\[\d{1,2}-\d{1,2}\]/g, "")
  );

  result = sanitizeAnswerCitations({ text: result, validLabels });

  return result;
};

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

/** Build a map from citation_label to source array index */
const buildLabelIndexMap = (sources: SourceInfo[] | undefined): Map<string, number> => {
  const map = new Map<string, number>();
  if (!sources) return map;
  for (let i = 0; i < sources.length; i++) {
    const label = sources[i].citation_label;
    if (label) map.set(label, i);
  }
  return map;
};

const parseCitationLabel = (href?: string): string | null => {
  if (!href) return null;
  const match = href.match(/^#source-(\d{1,2}-\d{1,2})$/);
  return match ? match[1] : null;
};

/** Resolve image src: convert relative /rag/... paths to absolute URLs */
const resolveImageSrc = (src: string): string => {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  const base = src.startsWith("/rag/")
    ? normalizeApiBase(QA_API_BASE)
    : normalizeApiBase(API_BASE);
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
  const [activeCitation, setActiveCitation] = useState<string | null>(null);
  const [activeSourceMessageId, setActiveSourceMessageId] = useState<string | null>(null);
  const [activeGraphMessageId, setActiveGraphMessageId] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [pdfSearchKeyword, setPdfSearchKeyword] = useState<string | undefined>(undefined);
  const [sourcePreviewCache, setSourcePreviewCache] = useState<Record<string, SourcePreview[]>>({});
  const sourcePrefetchingRef = useRef<Set<string>>(new Set());

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollTopBeforePdfRef = useRef<number | null>(null);

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

  const graphHostMessages = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.role === "assistant" &&
          Boolean(message.subgraph && message.subgraph.nodes && message.subgraph.nodes.length > 0)
      ),
    [messages]
  );

  const latestGraphMessage = graphHostMessages[graphHostMessages.length - 1] ?? null;

  const activeGraphMessage = useMemo(() => {
    if (!graphHostMessages.length) return null;
    const matched = graphHostMessages.find((message) => message.id === activeGraphMessageId);
    return matched ?? latestGraphMessage;
  }, [activeGraphMessageId, graphHostMessages, latestGraphMessage]);

  const activeGraphQuestion = useMemo(
    () => (activeGraphMessage ? findPrecedingQuestion(messages, activeGraphMessage.id) : undefined),
    [activeGraphMessage, messages]
  );

  const userScrolledUpRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current && !userScrolledUpRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  // Detect if user has scrolled away from the bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 80;
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // When a new user message is sent, reset scroll lock so we follow the response
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "user") {
      userScrolledUpRef.current = false;
    }
  }, [messages.length]);

  // Track previous messages length & isTyping to avoid scrolling on tab switches
  const prevMessagesLenRef = useRef(messages.length);
  const prevIsTypingRef = useRef(isTyping);

  useEffect(() => {
    const messagesChanged = prevMessagesLenRef.current !== messages.length;
    const typingChanged = prevIsTypingRef.current !== isTyping;
    prevMessagesLenRef.current = messages.length;
    prevIsTypingRef.current = isTyping;

    if (messagesChanged || typingChanged) {
      scrollToBottom();
    }
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

  useEffect(() => {
    if (!graphHostMessages.length) {
      setActiveGraphMessageId(null);
      return;
    }

    if (
      !activeGraphMessageId ||
      !graphHostMessages.some((message) => message.id === activeGraphMessageId)
    ) {
      setActiveGraphMessageId(graphHostMessages[graphHostMessages.length - 1].id);
    }
  }, [activeGraphMessageId, graphHostMessages]);

  useEffect(() => {
    const sourcesToPrefetch = sourceHostMessages.flatMap((msg) => msg.sources ?? []);
    if (sourcesToPrefetch.length === 0) return;

    const pending = sourcesToPrefetch.filter((source) => {
      const key = getSourcePreviewCacheKey(source);
      if (!key) return false;
      if (sourcePreviewCache[key]?.length) return false;
      if (sourcePrefetchingRef.current.has(key)) return false;
      return true;
    });

    if (pending.length === 0) return;

    pending.forEach((source) => {
      const key = getSourcePreviewCacheKey(source);
      if (key) sourcePrefetchingRef.current.add(key);
    });

    void prefetchSourcePreviews({
      sources: pending,
      query: activeSourceQuestion,
      qaApiBase: QA_API_BASE,
      onPreview: (chunkKey, preview) => {
        setSourcePreviewCache((prev) => {
          if (prev[chunkKey]?.length) return prev;
          return { ...prev, [chunkKey]: [preview as SourcePreview] };
        });
        sourcePrefetchingRef.current.delete(chunkKey);
      },
    }).finally(() => {
      pending.forEach((source) => {
        const key = getSourcePreviewCacheKey(source);
        if (key) sourcePrefetchingRef.current.delete(key);
      });
    });
  }, [activeSourceQuestion, sourceHostMessages, sourcePreviewCache]);

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
      pendingContent: "",
      thinking: "",
      thinkingDone: undefined,
      statusStage: "understanding",
      statusMessage: "正在理解你的问题...",
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
            const normalizedSources = normalizeCitationSources(sources);
            updateMessage(assistantId, (message) => ({
              ...message,
              // Keep retrieval sources stable (do not drop uncited docs). We still compute
              // "referenced" counts and citation badges from the answer text.
              sources: mergeStreamingSources(message.sources, normalizedSources),
            }));
            if (normalizedSources.length > 0) {
              setActiveSourceMessageId(assistantId);
            }
          },
          onRetrievalStats: (stats) => {
            updateMessage(assistantId, (message) => ({ ...message, retrievalStats: stats }));
          },
          onGraph: (subgraph) => {
            updateMessage(assistantId, (message) => ({ ...message, subgraph }));
            if (subgraph?.nodes?.length) {
              setActiveGraphMessageId(assistantId);
            }
          },
          onStatus: (stage, message) => {
            updateMessage(assistantId, (msg) => ({ ...msg, statusStage: stage, statusMessage: message }));
          },
          onThinking: (token) => {
            updateMessage(assistantId, (message) => {
              // If the backend emits late thinking tokens after we've already marked thinkingDone,
              // treat them as noise and keep the answer visible (avoids flicker).
              if (message.thinkingDone) {
                return {
                  ...message,
                  thinking: (message.thinking || "") + token,
                };
              }

              // Once we start receiving "thinking", hide any already streamed answer text until thinking completes.
              const moved = message.content || "";
              return {
                ...message,
                content: moved ? "" : message.content,
                pendingContent: (message.pendingContent || "") + moved,
                thinking: (message.thinking || "") + token,
                thinkingDone: false,
              };
            });
          },
          onThinkingDone: () => {
            updateMessage(assistantId, (message) => ({
              ...message,
              thinkingDone: true,
              content: message.content + (message.pendingContent || ""),
              pendingContent: "",
            }));
          },
          onAnswer: (token) => {
            updateMessage(assistantId, (message) => {
              const hasThinking = Boolean(message.thinking?.trim());
              if (hasThinking && !message.thinkingDone) {
                return {
                  ...message,
                  pendingContent: (message.pendingContent || "") + token,
                };
              }
              return {
                ...message,
                content: message.content + token,
              };
            });
          },
          onAnswerReplaced: (fullAnswer, replacedSources) => {
            updateMessage(assistantId, (message) => ({
              ...message,
              content: fullAnswer,
              pendingContent: "",
              thinkingDone: true,
              ...(replacedSources
                ? {
                    sources: mergeStreamingSources(
                      message.sources,
                      normalizeCitationSources(replacedSources)
                    ),
                  }
                : {}),
            }));
          },
          onDone: () => {
            updateMessage(assistantId, (message) => ({
              ...message,
              isStreaming: false,
              statusStage: undefined,
              statusMessage: undefined,
              thinkingDone: true,
              content: (message.content + (message.pendingContent || "")).trim()
                ? (message.content + (message.pendingContent || "")).trim()
                : "未返回答案。",
              pendingContent: "",
            }));
          },
          onError: (detail) => {
            updateMessage(assistantId, (message) => ({
              ...message,
              isStreaming: false,
              statusStage: undefined,
              statusMessage: undefined,
              content: message.content || `请求失败：${detail}`,
              pendingContent: "",
            }));
          },
        }
      );
    } catch {
            try {
              const response = await sendQuestion(question, history);
        const normalizedSources = normalizeCitationSources(response.sources || []);
        updateMessage(assistantId, (message) => ({
          ...message,
          content: (response.answer || "未返回答案。").trim(),
          sources: normalizedSources,
          isStreaming: false,
        }));
        if (normalizedSources.length > 0) {
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

  const handleCitationSelect = (messageId: string, citation: string, alignedSources?: SourceInfo[]) => {
    setActiveSourceMessageId(messageId);
    setActiveCitation(citation);

    const sourcesForLookup = alignedSources ?? messages.find((m) => m.id === messageId)?.sources ?? [];
    const labelMap = buildLabelIndexMap(sourcesForLookup);
    const idx = labelMap.get(citation);
    const src = idx !== undefined ? sourcesForLookup[idx] : undefined;
    if (src) {
      void resolvePdfUrlForSource(src).then((url) => {
        if (url) {
          scrollTopBeforePdfRef.current = scrollContainerRef.current?.scrollTop ?? null;
          setPdfSrc(url);
          setPdfSearchKeyword(resolvePdfSearchKeyword(src));
          return;
        }

        // If we can't open a PDF (e.g., graph source), fall back to the sources panel.
        setMaterialsTab("references");
        setActiveTab("materials");
      });
      return;
    }

    setMaterialsTab("references");
    setActiveTab("materials");
  };

  const handleClosePdf = useCallback(() => {
    setPdfSrc(null);
    setPdfSearchKeyword(undefined);
    const saved = scrollTopBeforePdfRef.current;
    scrollTopBeforePdfRef.current = null;

    if (saved === null) return;
    // Restore on the next frame after the overlay unmounts/reflow completes.
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = saved;
      }
    });
  }, []);


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
              参考资料
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" forceMount className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
            <div ref={scrollContainerRef} onScroll={handleScroll} className="qa-scrollbar h-full space-y-3 overflow-y-scroll px-4 py-4">
              {messages.map((message) => {
                const isAssistant = message.role === "assistant";
                const precedingQuestion = isAssistant ? findPrecedingQuestion(messages, message.id) : undefined;
              const sourcesNormalized = normalizeCitationSources(message.sources ?? []);
              const sourceCount = sourcesNormalized.length;
              const referencedCount = countReferencedCitations(message.content, sourcesNormalized);
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
                          sources={sourcesNormalized}
                          precedingQuestion={precedingQuestion}
                          onCitationSelect={(citation) => handleCitationSelect(message.id, citation, sourcesNormalized)}
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
                            引用 {referencedCount}
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

          <TabsContent value="materials" className="qa-scrollbar m-0 flex-1 min-h-0 overflow-y-auto p-4">
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
                        sources={normalizeCitationSources(activeSourceMessage.sources || [])}
                        query={activeSourceQuestion}
                        activeCitation={activeCitation}
                        onCitationHover={setActiveCitation}
                        onCitationSelect={setActiveCitation}
                        previewCache={sourcePreviewCache}
                        setPreviewCache={setSourcePreviewCache}
                        layout="inline"
                      />
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="graph" className="m-0">
                {graphHostMessages.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                    当前还没有可展示的图谱结果。您可以先提问一次，系统会把本次命中的节点与关系展示在这里。
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">关联回答</p>
                      <Select
                        value={
                          activeGraphMessage?.id ??
                          graphHostMessages[graphHostMessages.length - 1].id
                        }
                        onValueChange={(value) => setActiveGraphMessageId(value)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="选择回答" />
                        </SelectTrigger>
                        <SelectContent>
                          {graphHostMessages.map((message) => (
                            <SelectItem key={message.id} value={message.id}>
                              {getMessageTitle(message.content)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {activeGraphQuestion && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          问题：{activeGraphQuestion}
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border border-border overflow-hidden">
                      <KnowledgeGraph
                        subgraph={activeGraphMessage?.subgraph ?? null}
                        isStreaming={Boolean(activeGraphMessage?.isStreaming)}
                        height={320}
                      />
                    </div>
                  </div>
                )}
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

      {pdfSrc && <PdfLightbox src={pdfSrc} onClose={handleClosePdf} searchKeyword={pdfSearchKeyword} />}
    </div>
  );
}

function AssistantMessageBlock({
  message,
  sources,
  precedingQuestion,
  onCitationSelect,
  onFillInput,
  onImageClick,
}: {
  message: Message;
  sources: SourceInfo[];
  precedingQuestion?: string;
  onCitationSelect: (citation: string) => void;
  onFillInput?: (value: string) => void;
  onImageClick?: (src: string) => void;
}) {
  const labelMap = useMemo(() => buildLabelIndexMap(sources), [sources]);
  const markdownRef = useRef<HTMLDivElement>(null);

  // Detect overflowing KaTeX display formulas and add scroll-hint class.
  useEffect(() => {
    const el = markdownRef.current;
    if (!el) return;
    const displays = el.querySelectorAll<HTMLElement>(".katex-display");
    displays.forEach((d) => {
      if (d.scrollWidth > d.clientWidth + 2) {
        d.classList.add("katex-overflow");
      } else {
        d.classList.remove("katex-overflow");
      }
    });
  }, [message.content, message.isStreaming]);

  const { cleanContent, questions: recommendedQuestions } = useMemo(
    () => (message.isStreaming ? { cleanContent: message.content, questions: [] } : extractRecommendedQuestions(message.content)),
    [message.content, message.isStreaming]
  );
  const thinkingText = message.thinking?.trim() ?? "";

  const answerContent = useMemo(() => {
    const withTables = normalizeAnswerTables(cleanContent);
    const withArtifacts = normalizeAnswerMarkdownArtifacts(withTables, {
      streaming: message.isStreaming,
    });
    const normalized = message.isStreaming ? withArtifacts : normalizeCitations(withArtifacts, sources);
    const baseContent = stripInlineCitationLabels(normalized);
    const withImages = injectSourceImages(baseContent, sources, precedingQuestion);
    if (message.isStreaming) {
      return collapseFigureMentions(withImages);
    }
    const withTablesAndImages = injectSourceTables(withImages, sources);
    return collapseFigureMentions(withTablesAndImages);
  }, [cleanContent, sources, message.isStreaming, precedingQuestion]);

  return (
    <div className="space-y-2">
      {(message.isStreaming || thinkingText) && (
        <ThinkingProcess
          thinking={thinkingText}
          isStreaming={Boolean(message.isStreaming)}
          thinkingDone={Boolean(message.thinkingDone)}
          statusStage={message.statusStage}
          retrievalStats={message.retrievalStats}
          statusMessage={message.statusMessage}
        />
      )}

      {message.content ? (
        <div ref={markdownRef} className="qa-markdown prose prose-sm max-w-none break-words [overflow-wrap:anywhere] dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={QA_REMARK_PLUGINS}
            rehypePlugins={[rehypeKatex]}
            components={{
              h2: ({ children }) => (
                <h2 className="qa-heading-1 mt-6 mb-2.5 text-lg font-bold border-l-4 border-primary pl-2.5">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="qa-heading-2 mt-5 mb-2 text-base font-semibold text-primary/85">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="qa-heading-3 mt-3.5 mb-1.5 text-[13px] font-medium text-foreground/75">
                  {children}
                </h4>
              ),
              p: ({ children }) => {
                const isPlainText =
                  typeof children === "string" ||
                  (Array.isArray(children) && children.every((c) => typeof c === "string"));
                const plain = isPlainText
                  ? String(Array.isArray(children) ? children.join("") : children).trim()
                  : null;

                if (plain && (plain.startsWith("FIGCAPTION ") || /^图\d+[：:.]/.test(plain))) {
                  const shown = plain.replace(/^FIGCAPTION\s+/u, "");
                  return (
                    <p className="mt-1 mb-3 text-[11px] leading-snug text-muted-foreground/70 text-center italic">
                      {shown}
                    </p>
                  );
                }
                return <p className="mb-2 break-words [overflow-wrap:anywhere] last:mb-0">{children}</p>;
              },
              ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
              li: ({ children }) => {
                const plainText =
                  typeof children === "string"
                    ? children
                    : Array.isArray(children)
                      ? children.filter((c) => typeof c === "string").join("").trim()
                      : "";
                const isRetrievalReason = plainText.startsWith("资料调用理由（");
                const isRetrievalList = plainText.startsWith("检索资料清单");
                const className = isRetrievalReason
                  ? "mb-1 break-words [overflow-wrap:anywhere] last:mb-0"
                  : "mb-1 break-words [overflow-wrap:anywhere] last:mb-0";
                const content = (isRetrievalReason || isRetrievalList)
                  ? highlightRetrievalDocNames(children, "retrieval-doc")
                  : children;
                return <li className={className}>{content}</li>;
              },
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              em: ({ children }) => <em className="italic text-sky-700/80">{children}</em>,
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
                <blockquote className="rounded-md border border-border/55 bg-background/85 px-3 py-2 text-xs leading-relaxed text-muted-foreground shadow-sm">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="qa-table-wrap mb-2 overflow-x-auto rounded-md border border-border/80 bg-white/90 dark:bg-background/75">
                  <table className="min-w-full border-collapse text-xs">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-white/80 dark:bg-muted/45">{children}</thead>,
              th: ({ children }) => (
                <th className="border border-border bg-white/80 px-2 py-1 text-left font-semibold dark:bg-muted/45">{children}</th>
              ),
              td: ({ children }) => <td className="border border-border bg-white/55 px-2 py-1 align-top dark:bg-transparent">{children}</td>,
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
                        const img = e.target as HTMLImageElement;
                        img.alt = "";
                        img.title = "参考图片暂不可用";
                        // Hide broken-image icon and fallback alt text to keep layout clean.
                        img.style.display = "none";
                      }}
                    />
                  );
                },
              a: ({ href, children }) => {
                const citationLabel = parseCitationLabel(href);
                if (!citationLabel) {
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
                      {children}
                    </a>
                  );
                }

                const sourceIdx = labelMap.get(citationLabel);
                const source = sourceIdx !== undefined ? sources[sourceIdx] : undefined;
                return (
                  <CitationBadge
                    label={citationLabel}
                    source={source}
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
  label,
  source,
  onClick,
  children,
}: {
  label: string;
  source?: SourceInfo;
  onClick: (citation: string) => void;
  children: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onClick(label);
    setTimeout(() => {
      const target = document.getElementById(`source-${label}`);
      if (target) {
        target.classList.add("qa-source-flash");
        setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
      }
    }, 100);
  };

  const titleText = source?.name
    ? source.name
    : `引用 [${label}]`;

  const displayLabel = label;

  return (
    <a
      href={`#source-${label}`}
      title={titleText}
      className="inline-flex min-h-5 items-center gap-0.5 rounded-full border border-red-400 bg-red-50 px-1.5 text-[10px] font-medium text-red-600 no-underline transition-colors hover:bg-red-100 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
      onClick={handleClick}
    >
      {displayLabel}
    </a>
  );
}

