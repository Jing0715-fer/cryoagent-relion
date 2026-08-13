"use client";

import * as Icons from "lucide-react";
import { LucideProps } from "lucide-react";

// Dynamically render a lucide icon by name (fallback to Box).
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name] || Icons.Box;
  return <Cmp {...props} />;
}
