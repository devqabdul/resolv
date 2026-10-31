'use client';
import ReactMarkdown, { type Components } from "react-markdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Markdown mapped onto shadcn table + semantic tokens; no typography plugin.
const components: Components = {
  h1: (p) => <h2 className="mb-3 mt-2 text-xl font-semibold tracking-tight" {...p} />,
  h2: (p) => <h3 className="mb-2 mt-6 text-lg font-semibold tracking-tight" {...p} />,
  h3: (p) => <h4 className="mb-2 mt-4 text-base font-semibold" {...p} />,
  p: (p) => <p className="my-2 text-sm leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-2 ml-5 list-disc text-sm leading-relaxed" {...p} />,
  ol: (p) => <ol className="my-2 ml-5 list-decimal text-sm leading-relaxed" {...p} />,
  code: (p) => <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p} />,
  pre: (p) => <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm" {...p} />,
  table: (p) => <Table className="my-3" {...p} />,
  thead: (p) => <TableHeader {...p} />,
  tbody: (p) => <TableBody {...p} />,
  tr: (p) => <TableRow {...p} />,
  th: (p) => <TableHead {...p} />,
  td: (p) => <TableCell className="font-mono tabular-nums" {...p} />,
};

export default function Markdown({ children, testId }: { children: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
