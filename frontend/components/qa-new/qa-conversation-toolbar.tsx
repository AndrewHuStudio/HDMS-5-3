"use client";

import { useMemo } from "react";
import { History, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QAViewConversation } from "@/lib/stores/qa-store";

type ConversationOption = Pick<QAViewConversation, "id" | "title" | "pinned" | "updatedAt">;

interface QAConversationToolbarProps {
  conversations: ConversationOption[];
  activeConversationId: string;
  disabled?: boolean;
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

export function QAConversationToolbar({
  conversations,
  activeConversationId,
  disabled = false,
  onCreateConversation,
  onSwitchConversation,
  onRenameConversation,
  onDeleteConversation,
  onTogglePinConversation,
}: QAConversationToolbarProps) {
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations]
  );

  const handleRenameConversation = () => {
    if (!activeConversation) return;
    const nextTitle = window.prompt("重命名对话", activeConversation.title);
    if (!nextTitle) return;
    onRenameConversation(activeConversation.id, nextTitle);
  };

  const handleDeleteConversation = () => {
    if (!activeConversation) return;
    const confirmed = window.confirm(`确定删除“${activeConversation.title}”吗？`);
    if (!confirmed) return;
    onDeleteConversation(activeConversation.id);
  };

  return (
    <div className="border-b border-border bg-card px-4 py-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">管控问答助手</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">历史对话管理</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={onCreateConversation}
            disabled={disabled}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            新建对话
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={disabled || !activeConversation}
                aria-label="会话管理"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>会话管理</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleRenameConversation}>
                <Pencil className="mr-2 h-4 w-4" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => activeConversation && onTogglePinConversation(activeConversation.id)}>
                {activeConversation?.pinned ? (
                  <PinOff className="mr-2 h-4 w-4" />
                ) : (
                  <Pin className="mr-2 h-4 w-4" />
                )}
                {activeConversation?.pinned ? "取消置顶" : "置顶"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleDeleteConversation}>
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          <span>历史对话</span>
        </div>
        <Select value={activeConversationId} onValueChange={onSwitchConversation} disabled={disabled}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="选择历史对话" />
          </SelectTrigger>
          <SelectContent>
            {conversations.map((conversation) => (
              <SelectItem key={conversation.id} value={conversation.id}>
                {conversation.pinned ? `📌 ${conversation.title}` : conversation.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeConversation ? (
          <p className="text-[11px] text-muted-foreground">
            最近更新：{formatConversationTime(activeConversation.updatedAt)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
