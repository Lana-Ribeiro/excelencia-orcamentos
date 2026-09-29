import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { CurrencyCode, FxRate } from "../../shared/types";

// ---------------- roteador por hash ----------------
export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}
export const go = (path: string) => {
  window.location.hash = path;
};

// ---------------- contexto global ----------------
interface Toast {
  id: number;
  text: string;
  tone?: "bad";
}
interface AppCtx {
  rates: FxRate[];
  ratesOffline: boolean;
  rateOf: (code: CurrencyCode) => number;
  refreshRates: () => Promise<void>;
  ai: { configured: boolean; model: string } | null;
  toast: (text: string, tone?: "bad") => void;
}
const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<FxRate[]>([]);
  const [offline, setOffline] = useState(false);
  const [ai, setAi] = useState<AppCtx["ai"]>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const load = useCallback(async (force = false) => {
    try {
      const r = await api.fx(force);
      setRates(r.rates);
      setOffline(r.offline);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    load();
    api.health().then((h) => setAi(h.ai)).catch(() => setAi({ configured: false, model: "" }));
    const t = setInterval(() => load(), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const toast = useCallback((text: string, tone?: "bad") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const value = useMemo<AppCtx>(
    () => ({
      rates,
      ratesOffline: offline,
      rateOf: (code) => (code === "BRL" ? 1 : rates.find((r) => r.code === code)?.rate ?? 0),
      refreshRates: () => load(true),
      ai,
      toast,
    }),
    [rates, offline, ai, toast, load],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Gera e baixa o Excel do orçamento (no navegador, pode levar alguns segundos). */
export function useDownloadExcel() {
  const { toast } = useApp();
  return useCallback(
    async (id: string) => {
      toast("Gerando o Excel…");
      await new Promise((r) => setTimeout(r, 60)); // deixa o aviso aparecer antes do processamento
      try {
        await api.downloadExcel(id);
      } catch (e) {
        toast((e as Error).message, "bad");
      }
    },
    [toast],
  );
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppProvider ausente");
  return c;
}
