import { create } from "zustand";
import type { ChatMessage, SourceInfo } from "@/features/qa/types";

export interface QAPanelMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string;
  sources?: SourceInfo[];
  isStreaming?: boolean;
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
    "您好！我是城市管控助手。您可以直接提问城市管控相关问题，我会结合知识库与您后续上传的资料生成图文并茂的答案，并提供关键指标解读与调整建议。",
  timestamp: new Date(),
});

const createViewWelcomeMessage = (): ChatMessage => ({
  id: "welcome",
  role: "assistant",
  content:
    "你好，我是 HDMS 问答助手。你可以提问管控要素、指标解释或上传资料中的具体问题。",
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
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  appendMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updater: (msg: ChatMessage) => ChatMessage) => void;
  resetMessages: () => void;
}

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
  messages: [createViewWelcomeMessage()],
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  updateMessage: (id, updater) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? updater(msg) : msg
      ),
    })),
  resetMessages: () => set({ messages: [createViewWelcomeMessage()] }),
}));
