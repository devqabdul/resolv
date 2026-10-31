// Reviewer picker (user, 31 Oct): a dropdown pre-set to the presenter, so nobody types a name on stage.
// Native <select> styled like Input so Playwright select_option keeps working.
import { cn } from "@/lib/utils";

export const REVIEWERS = ["Abdul Qureshi"];
export const DEFAULT_REVIEWER = REVIEWERS[0];

export default function ReviewerSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      {REVIEWERS.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}
