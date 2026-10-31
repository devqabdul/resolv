'use client';
// Which panels are open (notifications = the Notifications group in the left sidebar), persisted in localStorage ("resolv-layout"). Defaults (first visit,
// SSR, first paint) are everything open. Focus mode snapshots the previous state in `saved`;
// opening or closing any single panel afterwards ends focus mode. The sidebar itself stays with
// shadcn's SidebarProvider (cookie), only its previous state is remembered here for restoring.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Panel = "notificationsOpen" | "kpiOpen" | "demoOpen";
type Saved = { sidebar: boolean; notificationsOpen: boolean; kpiOpen: boolean; demoOpen: boolean };
type State = Record<Panel, boolean> & { saved: Saved | null };

const KEY = "resolv-layout";
const DEFAULTS: State = { notificationsOpen: true, kpiOpen: true, demoOpen: true, saved: null };
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function read(): State {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (!raw || ![raw.notificationsOpen, raw.kpiOpen, raw.demoOpen].every(isBool)) return DEFAULTS;
    const s = raw.saved;
    const saved = s && [s.sidebar, s.notificationsOpen, s.kpiOpen, s.demoOpen].every(isBool) ? (s as Saved) : null;
    return { notificationsOpen: raw.notificationsOpen, kpiOpen: raw.kpiOpen, demoOpen: raw.demoOpen, saved };
  } catch {
    return DEFAULTS;
  }
}

type Ctx = Record<Panel, boolean> & {
  focus: boolean;
  /** false until the stored state is applied and one frame has passed, so restoring is not animated */
  motionOn: boolean;
  setPanel: (panel: Panel, open: boolean) => void;
  enterFocus: (sidebarOpen: boolean) => void;
  /** Restores the panels and returns whether the sidebar was open before focus mode. */
  exitFocus: () => boolean;
};

const LayoutStateContext = createContext<Ctx | null>(null);

export function LayoutStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [motionOn, setMotionOn] = useState(false);

  useEffect(() => {
    setState(read());
    setHydrated(true);
    const raf = requestAnimationFrame(() => setMotionOn(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage blocked: the layout just does not persist */
    }
  }, [state, hydrated]);

  const setPanel = useCallback((panel: Panel, open: boolean) => setState((s) => ({ ...s, [panel]: open, saved: null })), []);
  const enterFocus = useCallback(
    (sidebar: boolean) =>
      setState((s) => ({
        notificationsOpen: false,
        kpiOpen: false,
        demoOpen: false,
        saved: { sidebar, notificationsOpen: s.notificationsOpen, kpiOpen: s.kpiOpen, demoOpen: s.demoOpen },
      })),
    [],
  );
  const exitFocus = useCallback(() => {
    const saved = state.saved;
    setState({
      notificationsOpen: saved?.notificationsOpen ?? true,
      kpiOpen: saved?.kpiOpen ?? true,
      demoOpen: saved?.demoOpen ?? true,
      saved: null,
    });
    return saved?.sidebar ?? true;
  }, [state.saved]);

  const value = useMemo<Ctx>(
    () => ({ ...state, focus: state.saved !== null, motionOn, setPanel, enterFocus, exitFocus }),
    [state, motionOn, setPanel, enterFocus, exitFocus],
  );
  return <LayoutStateContext.Provider value={value}>{children}</LayoutStateContext.Provider>;
}

export function useLayoutState(): Ctx {
  const ctx = useContext(LayoutStateContext);
  if (!ctx) throw new Error("useLayoutState must be used within a LayoutStateProvider.");
  return ctx;
}
