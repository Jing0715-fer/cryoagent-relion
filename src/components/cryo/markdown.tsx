"use client";

import ReactMarkdown from "react-markdown";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="cryo-md text-sm">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
