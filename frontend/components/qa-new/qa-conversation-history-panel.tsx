"use client";

import { useMemo } from "react";
import { Clock3, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QAViewConversation } from "@/lib/stores/qa-store";
import { cn } from "@/lib/utils";

type ConversationOption = Pick<QAViewConversation, "id" | "title" | "pinned" | "updatedAt">;

interface QAConversationHistoryPanelProps {
  conversations: ConversationOption[];
  activeConversationId: string;
  disabled?: boolean;
  historyOpen: boolean;
  onCreateConversation: () => void;
  onSwitchConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onTogglePinConversation: (id: string) => void;
}

function formatConversationTime(updatedAt: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(updatedAt);
}

export function QAConversationHistoryPanel({
  conversations,
  activeConversationId,
  disabled = false,
  historyOpen,
  onCreateConversation,
  onSwitchConversation,
  onRenameConversation,
  onDeleteConversation,
  onTogglePinConversation,
}: QAConversationHistoryPanelProps) {
  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const pinOrder = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        if (pinOrder !== 0) {
          return pinOrder;
        }
        return b.updatedAt - a.updatedAt;
      }),
    [conversations]
  );

  const handleRenameConversation = (conversation: ConversationOption) => {
    const nextTitle = window.prompt("重命名对话", conversation.title);
    if (!nextTitle) return;
    onRenameConversation(conversation.id, nextTitle);
  };

  const handleDeleteConversation = (conversation: ConversationOption) => {
    const confirmed = window.confirm(`确定删除“${conversation.title}”吗？`);
    if (!confirmed) return;
    onDeleteConversation(conversation.id);
  };

  return (
    <aside
      className={cn(
        "min-h-0 shrink-0 overflow-hidden transition-[width,opacity,transform] duration-300 ease-out",
        historyOpen ? "w-[280px] translate-x-0 opacity-100" : "pointer-events-none w-0 translate-x-6 opacity-0"
      )}
      aria-hidden={!historyOpen}
    >
      <div className="flex h-full min-h-0 w-[280px] flex-col overflow-hidden bg-card">
        <div className="h-12 border-b border-border flex items-center justify-between gap-3 px-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">历史对话</p>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={onCreateConversation}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            新建对话
          </Button>
        </div>

        <div className="qa-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {sortedConversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;

            return (
              <div
                key={conversation.id}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border px-3 py-3 transition-colors",
                  isActive
                    ? "border-primary/30 bg-primary/10 shadow-sm"
                    : "border-border/70 bg-background/70 hover:border-primary/20 hover:bg-accent/40"
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSwitchConversation(conversation.id)}
                  disabled={disabled}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{conversation.title}</p>
                      {conversation.pinned ? (
                        <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      <span>最近更新</span>
                      <span>{formatConversationTime(conversation.updatedAt)}</span>
                    </div>
                  </div>
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-full"
                      disabled={disabled}
                      aria-label={`${conversation.title} 会话管理`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel>会话管理</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleRenameConversation(conversation)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onTogglePinConversation(conversation.id)}>
                      {conversation.pinned ? (
                        <PinOff className="mr-2 h-4 w-4" />
                      ) : (
                        <Pin className="mr-2 h-4 w-4" />
                      )}
                      {conversation.pinned ? "取消置顶" : "置顶"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-600 focus:text-red-600"
                      onClick={() => handleDeleteConversation(conversation)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
