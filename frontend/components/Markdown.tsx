'use client';
import ReactMarkdown from "react-markdown";

// Minimal typography via arbitrary-variant classes; no typography plugin (D1).
const CLS =
  "[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-navy " +
  "[&_li]:ml-5 [&_li]:list-disc [&_p]:my-2 [&_table]:my-2 [&_table]:w-full [&_th]:border-b-2 [&_th]:border-navy/30 " +
  "[&_th]:px-3 [&_th]:py-1 [&_th]:text-left [&_td]:border-b [&_td]:border-navy/10 [&_td]:px-3 [&_td]:py-1";

export default function Markdown({ children, testId }: { children: string; testId?: string }) {
  return (
    <div data-testid={testId} className={`rounded-xl bg-white p-6 text-lg shadow-sm ${CLS}`}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
