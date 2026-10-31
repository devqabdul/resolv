'use client';
// Theme (class on <html>, localStorage, system default, no flash), tooltips and the one Toaster.
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { LayoutStateProvider } from "@/components/app-shell/layout-state";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="resolv-theme" disableTransitionOnChange>
      <TooltipProvider>
        <LayoutStateProvider>{children}</LayoutStateProvider>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
