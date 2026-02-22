"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ComingSoonPanelProps {
  title: string;
  description?: string;
}

export function ComingSoonPanel({ title, description = "该功能正在开发中，敬请期待。" }: ComingSoonPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
