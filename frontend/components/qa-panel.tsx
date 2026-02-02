"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import type { CityElement } from "@/lib/city-data";
import { elementTypeNames } from "@/lib/city-data";
import { Send, Network, MessageSquare } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface QAPanelProps {
  selectedElement: CityElement | null;
}

// 模拟AI回答
function generateAIResponse(
  question: string,
  element: CityElement | null
): string {
  const controlElements = [
    { name: "建筑限高", description: "控制天际线与城市风貌，避免超高超密建设。" },
    { name: "建筑退线", description: "保障街道空间尺度与公共安全通行。" },
    { name: "容积率", description: "反映开发强度与用地效率，是核心控制指标。" },
    { name: "建筑密度", description: "平衡建设量与开放空间，提高场地舒适度。" },
    { name: "绿地率", description: "提升生态与景观品质，优化微气候。" },
    { name: "停车配建", description: "匹配出行需求，缓解交通压力。" },
    { name: "日照要求", description: "保障居住舒适度与公共空间品质。" },
    { name: "消防通道", description: "满足应急与安全疏散要求。" },
    { name: "视廊保护", description: "保障城市景观视线与特色风貌。" },
    { name: "交通影响", description: "评估路网承载与出行效率。" },
  ];

  const valuePoints = [
    "快速定位合规风险与关键指标",
    "联动管控要素之间的影响关系",
    "结合资料生成图文并茂的解释与建议",
    "为方案调整提供可执行的决策支持",
  ];

  const lowerQuestion = question.toLowerCase();

  if (!element) {
    if (lowerQuestion.includes("要素") || lowerQuestion.includes("指标") || lowerQuestion.includes("管控")) {
      return `城市管控核心要素包括：\n${controlElements
        .map((item) => `• ${item.name}：${item.description}`)
        .join("\n")}`;
    }

    if (lowerQuestion.includes("价值") || lowerQuestion.includes("作用") || lowerQuestion.includes("能做什么")) {
      return `系统可为你提供的价值：\n${valuePoints.map((item) => `• ${item}`).join("\n")}`;
    }

    if (lowerQuestion.includes("图谱") || lowerQuestion.includes("关系") || lowerQuestion.includes("关联")) {
      return "知识图谱用于展示管控要素之间的关联关系，例如“限高/视廊/日照”共同影响城市风貌与居住品质，“容积率/密度/绿地率”共同影响开发强度与开放空间。";
    }

    return `你可以直接提问城市管控相关问题，例如限高、退线、容积率、日照、停车等。我会结合你上传的资料生成图文并茂的答案。`;
  }

  if (
    lowerQuestion.includes("介绍") ||
    lowerQuestion.includes("概况") ||
    lowerQuestion.includes("是什么")
  ) {
    return `【${element.name}】\n\n${element.knowledgeBase.join("\n\n")}`;
  }

  if (
    lowerQuestion.includes("面积") ||
    lowerQuestion.includes("大小") ||
    lowerQuestion.includes("规模")
  ) {
    return `${element.name}的总建筑/占地面积为 ${element.info.area.toLocaleString()} 平方米。${
      element.info.floors ? `共 ${element.info.floors} 层，` : ""
    }${element.info.height ? `建筑高度 ${element.info.height} 米。` : ""}`;
  }

  if (
    lowerQuestion.includes("用途") ||
    lowerQuestion.includes("功能") ||
    lowerQuestion.includes("用地")
  ) {
    return `${element.name}的主要用途为：${element.info.usage}。\n\n${element.knowledgeBase[0] || ""}`;
  }

  if (
    lowerQuestion.includes("管控") ||
    lowerQuestion.includes("指标") ||
    lowerQuestion.includes("规划")
  ) {
    const controlsInfo = element.controls
      .map(
        (c) =>
          `• ${c.name}：当前值 ${c.currentValue}${c.unit}，限制值 ${c.limitValue}${c.unit}`
      )
      .join("\n");
    return `${element.name}的主要管控指标如下：\n\n${controlsInfo}`;
  }

  if (
    lowerQuestion.includes("问题") ||
    lowerQuestion.includes("超标") ||
    lowerQuestion.includes("不符合")
  ) {
    const issues = element.controls.filter((c) => c.status !== "safe");
    if (issues.length === 0) {
      return `${element.name}目前所有管控指标均符合要求，没有发现问题。`;
    }
    const issuesInfo = issues
      .map(
        (c) =>
          `• ${c.name}：当前 ${c.currentValue}${c.unit}，要求 ${c.limitValue}${c.unit}\n  建议：${c.suggestion || "待评估"}`
      )
      .join("\n\n");
    return `${element.name}存在以下需要关注的问题：\n\n${issuesInfo}`;
  }

  return `关于${element.name}，这是一个${elementTypeNames[element.type]}类型的城市要素。\n\n${element.knowledgeBase[0] || "暂无更多信息。"}\n\n您可以询问关于面积、用途、管控指标等方面的问题。`;
}

const quickQuestions = [
  "城市管控要素有哪些",
  "限高控制有什么要求",
  "容积率如何影响开发强度",
  "系统能提供哪些价值",
];

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
    if (!input.trim()) return;

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    await new Promise((resolve) => setTimeout(resolve, 800));

    const aiResponse = generateAIResponse(input, selectedElement);
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "assistant",
      content: aiResponse,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsTyping(false);
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
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
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
