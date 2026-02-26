/**
 * QA 问答状态管理 Store (Zustand)
 *
 * 管理 QA 助手的全局状态：
 * - 对话列表（conversations）、当前对话 ID
 * - 消息历史、流式状态、输入框内容
 * - 思考过程、来源引用、检索统计、知识图谱
 * - 对话创建、切换、删除、消息追加等操作
 */
import { create } from "zustand";
import type { ChatMessage, SourceInfo, RetrievalStats, SubgraphData } from "@/features/qa/types";

export interface QAPanelMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string;
  /** Signal from SSE that the model's thinking phase has completed. */
  thinkingDone?: boolean;
  /** Internal buffer for answer tokens while thinking is still streaming (to avoid early "吐字"). */
  pendingContent?: string;
  sources?: SourceInfo[];
  retrievalStats?: RetrievalStats;
  subgraph?: SubgraphData;
  feedback?: "useful" | "not_useful";
  isStreaming?: boolean;
  statusMessage?: string;
  statusStage?: string;
}

export interface QAPanelConversation {
  id: string;
  title: string;
  messages: QAPanelMessage[];
  lastContextElementId: string | null;
  updatedAt: number;
}

const DEFAULT_TITLE_PREFIX = "新对话";

const createPanelWelcomeMessage = (): QAPanelMessage => ({
  id: "welcome",
  role: "assistant",
  content:
    "您好！我是 HDMS 城市设计知识问答助手，服务于高强度片区的设计管控决策。您可以提问城市设计管控相关问题，我会结合课题知识库与上传资料，提供有据可查的分析与建议。",
  timestamp: new Date(),
});

const createViewWelcomeMessage = (): ChatMessage => ({
  id: "welcome",
  role: "assistant",
  content:
    "您好，我是 HDMS 城市设计知识问答助手。您可以提问高强度片区的规划管控、地块指标、方案评估等问题，我会基于课题知识库为您提供结构化的分析回答。",
  createdAt: new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }),
});

const createConversationId = () =>
  `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createConversationTitle = (index: number) =>
  `${DEFAULT_TITLE_PREFIX} ${index}`;

const createPanelConversation = (index: number): QAPanelConversation => ({
  id: createConversationId(),
  title: createConversationTitle(index),
  messages: [createPanelWelcomeMessage()],
  lastContextElementId: null,
  updatedAt: Date.now(),
});

interface QAPanelState {
  conversations: QAPanelConversation[];
  activeConversationId: string;
  createConversation: () => void;
  switchConversation: (id: string) => void;
  setConversations: (conversations: QAPanelConversation[]) => void;
  setActiveConversationTitle: (title: string) => void;
  appendMessage: (message: QAPanelMessage) => void;
  updateMessage: (id: string, updater: (msg: QAPanelMessage) => QAPanelMessage) => void;
  resetActiveConversation: () => void;
  setActiveConversationContextId: (id: string | null) => void;
}

interface QAViewState {
  conversations: QAViewConversation[];
  activeConversationId: string;
  createConversation: () => void;
  switchConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  togglePinConversation: (id: string) => void;
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  appendMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updater: (msg: ChatMessage) => ChatMessage) => void;
  resetMessages: () => void;
}

export interface QAViewConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  pinned?: boolean;
}

const VIEW_DEFAULT_TITLE_PREFIX = "新对话";

const createViewConversationId = () =>
  `qa-view-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createViewConversationTitle = (index: number) =>
  `${VIEW_DEFAULT_TITLE_PREFIX} ${index}`;

const createViewConversation = (index: number): QAViewConversation => ({
  id: createViewConversationId(),
  title: createViewConversationTitle(index),
  messages: [createViewWelcomeMessage()],
  updatedAt: Date.now(),
  pinned: false,
});

const sortViewConversations = (conversations: QAViewConversation[]) =>
  [...conversations].sort((a, b) => {
    const aPinned = Boolean(a.pinned);
    const bPinned = Boolean(b.pinned);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });

const getViewConversationTitleFromMessage = (message: ChatMessage) => {
  const trimmed = (message.content || "").trim();
  if (!trimmed) return "";
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
};

const initialViewConversation = createViewConversation(1);

const getConversationTitleFromMessage = (message: QAPanelMessage) => {
  const trimmed = message.content.trim();
  if (!trimmed) return "";
  return trimmed.length > 12 ? `${trimmed.slice(0, 12)}...` : trimmed;
};

const initialConversation = createPanelConversation(1);

export const useQAPanelStore = create<QAPanelState>((set) => ({
  conversations: [initialConversation],
  activeConversationId: initialConversation.id,
  createConversation: () =>
    set((state) => {
      const nextIndex = state.conversations.length + 1;
      const newConversation = createPanelConversation(nextIndex);
      return {
        conversations: [newConversation, ...state.conversations],
        activeConversationId: newConversation.id,
      };
    }),
  switchConversation: (id) =>
    set((state) => {
      if (state.conversations.some((conversation) => conversation.id === id)) {
        return { activeConversationId: id };
      }
      return {};
    }),
  setConversations: (conversations) => set({ conversations }),
  setActiveConversationTitle: (title) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === state.activeConversationId
          ? { ...conversation, title }
          : conversation
      ),
    })),
  appendMessage: (message) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== state.activeConversationId) {
          return conversation;
        }
        const updatedMessages = [...conversation.messages, message];
        let nextTitle = conversation.title;
        if (
          message.role === "user" &&
          conversation.title.startsWith(DEFAULT_TITLE_PREFIX)
        ) {
          const derivedTitle = getConversationTitleFromMessage(message);
          if (derivedTitle) {
            nextTitle = derivedTitle;
          }
        }
        return {
          ...conversation,
          messages: updatedMessages,
          title: nextTitle,
          updatedAt: Date.now(),
        };
      }),
    })),
  updateMessage: (id, updater) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== state.activeConversationId) return conversation;
        return {
          ...conversation,
          messages: conversation.messages.map((msg) =>
            msg.id === id ? updater(msg) : msg
          ),
          updatedAt: Date.now(),
        };
      }),
    })),
  resetActiveConversation: () =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === state.activeConversationId
          ? {
              ...conversation,
              messages: [createPanelWelcomeMessage()],
              lastContextElementId: null,
              updatedAt: Date.now(),
            }
          : conversation
      ),
    })),
  setActiveConversationContextId: (id) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === state.activeConversationId
          ? { ...conversation, lastContextElementId: id }
          : conversation
      ),
    })),
}));

export const useQAViewStore = create<QAViewState>((set) => ({
  conversations: [initialViewConversation],
  activeConversationId: initialViewConversation.id,
  createConversation: () =>
    set((state) => {
      const nextIndex = state.conversations.length + 1;
      const nextConversation = createViewConversation(nextIndex);
      return {
        conversations: sortViewConversations([nextConversation, ...state.conversations]),
        activeConversationId: nextConversation.id,
        messages: nextConversation.messages,
      };
    }),
  switchConversation: (id) =>
    set((state) => {
      const target = state.conversations.find((conversation) => conversation.id === id);
      if (!target) return {};
      return {
        activeConversationId: target.id,
        messages: target.messages,
      };
    }),
  renameConversation: (id, title) =>
    set((state) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return {};
      return {
        conversations: state.conversations.map((conversation) =>
          conversation.id === id
            ? { ...conversation, title: trimmedTitle, updatedAt: Date.now() }
            : conversation
        ),
      };
    }),
  deleteConversation: (id) =>
    set((state) => {
      const idx = state.conversations.findIndex((conversation) => conversation.id === id);
      if (idx < 0) return {};

      if (state.conversations.length === 1) {
        const resetConversation = {
          ...state.conversations[0],
          title: createViewConversationTitle(1),
          messages: [createViewWelcomeMessage()],
          updatedAt: Date.now(),
          pinned: false,
        };
        return {
          conversations: [resetConversation],
          activeConversationId: resetConversation.id,
          messages: resetConversation.messages,
        };
      }

      const remaining = sortViewConversations(
        state.conversations.filter((conversation) => conversation.id !== id)
      );
      const fallbackActive = remaining[0];
      const nextActiveId =
        state.activeConversationId === id ? fallbackActive.id : state.activeConversationId;
      const nextActive =
        remaining.find((conversation) => conversation.id === nextActiveId) ?? fallbackActive;
      return {
        conversations: remaining,
        activeConversationId: nextActive.id,
        messages: nextActive.messages,
      };
    }),
  togglePinConversation: (id) =>
    set((state) => {
      const nextConversations = sortViewConversations(
        state.conversations.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                pinned: !conversation.pinned,
                updatedAt: Date.now(),
              }
            : conversation
        )
      );
      return {
        conversations: nextConversations,
      };
    }),
  messages: initialViewConversation.messages,
  setMessages: (messages) =>
    set((state) => {
      const nextConversations = sortViewConversations(
        state.conversations.map((conversation) =>
          conversation.id === state.activeConversationId
            ? { ...conversation, messages, updatedAt: Date.now() }
            : conversation
        )
      );
      return {
        messages,
        conversations: nextConversations,
      };
    }),
  appendMessage: (message) =>
    set((state) => {
      const nextMessages = [...state.messages, message];
      const now = Date.now();
      const nextConversations = sortViewConversations(
        state.conversations.map((conversation) => {
          if (conversation.id !== state.activeConversationId) return conversation;
          let nextTitle = conversation.title;
          if (
            message.role === "user" &&
            conversation.title.startsWith(VIEW_DEFAULT_TITLE_PREFIX)
          ) {
            const derivedTitle = getViewConversationTitleFromMessage(message);
            if (derivedTitle) {
              nextTitle = derivedTitle;
            }
          }
          return {
            ...conversation,
            title: nextTitle,
            messages: nextMessages,
            updatedAt: now,
          };
        })
      );
      return {
        messages: nextMessages,
        conversations: nextConversations,
      };
    }),
  updateMessage: (id, updater) =>
    set((state) => {
      const nextMessages = state.messages.map((msg) =>
        msg.id === id ? updater(msg) : msg
      );
      const nextConversations = sortViewConversations(
        state.conversations.map((conversation) =>
          conversation.id === state.activeConversationId
            ? { ...conversation, messages: nextMessages, updatedAt: Date.now() }
            : conversation
        )
      );
      return {
        messages: nextMessages,
        conversations: nextConversations,
      };
    }),
  resetMessages: () =>
    set((state) => {
      const resetMessages = [createViewWelcomeMessage()];
      const nextConversations = sortViewConversations(
        state.conversations.map((conversation) =>
          conversation.id === state.activeConversationId
            ? { ...conversation, messages: resetMessages, updatedAt: Date.now() }
            : conversation
        )
      );
      return {
        messages: resetMessages,
        conversations: nextConversations,
      };
    }),
}));
