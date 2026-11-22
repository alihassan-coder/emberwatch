"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Two views of the same question, "how good is it?": the numbers, and real examples. */
export function ResultsTabs({ accuracy, examples }: { accuracy: React.ReactNode; examples: React.ReactNode }) {
  return (
    <Tabs defaultValue="accuracy" className="gap-6">
      <TabsList>
        <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
        <TabsTrigger value="examples">Try to fool it</TabsTrigger>
      </TabsList>
      <TabsContent value="accuracy">{accuracy}</TabsContent>
      <TabsContent value="examples">{examples}</TabsContent>
    </Tabs>
  );
}
