import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ProjectPayload } from "./api";
import type { AnyProject, SyncState } from "../../shared/types";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** Estado de um orçamento aberto: desfazer/refazer e gravação automática (JSON + Excel). */
export function useProjectDoc<T extends AnyProject>(id: string) {
  const [payload, setPayload] = useState<ProjectPayload | null>(null);
  const [doc, setDoc] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [sync, setSync] = useState<SyncState | undefined>();
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [, bump] = useState(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const latest = useRef<T | null>(null);

  useEffect(() => {
    let alive = true;
    setPayload(null);
    setDoc(null);
    past.current = [];
    future.current = [];
    api
      .project(id)
      .then((p) => {
        if (!alive) return;
        setPayload(p);
        setDoc(p.project as T);
        latest.current = p.project as T;
        setSync(p.project.sync);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  const flush = useCallback(async () => {
    if (saving.current || !dirty.current || !latest.current) return;
    saving.current = true;
    dirty.current = false;
    setSaveState("saving");
    try {
      const r = await api.saveProject(latest.current);
      setSync(r.sync);
      setSaveState(r.sync.lastError ? "error" : "saved");
    } catch (e) {
      setSaveState("error");
      setSync((s) => ({ ...(s ?? { excelFile: "" }), lastError: (e as Error).message }));
      dirty.current = true;
    } finally {
      saving.current = false;
      if (dirty.current) setTimeout(flush, 400);
    }
  }, []);

  // grava 900 ms após a última alteração
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const schedule = useCallback(() => {
    dirty.current = true;
    setSaveState("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  }, [flush]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) {
        e.preventDefault();
        flush();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (dirty.current) flush();
    };
  }, [flush]);

  const update = useCallback(
    (fn: (p: T) => T) => {
      setDoc((cur) => {
        if (!cur) return cur;
        const next = fn(cur);
        if (next === cur) return cur;
        past.current.push(cur);
        if (past.current.length > 150) past.current.shift();
        future.current = [];
        latest.current = next;
        return next;
      });
      schedule();
      bump((x) => x + 1);
    },
    [schedule],
  );

  const undo = useCallback(() => {
    setDoc((cur) => {
      const prev = past.current.pop();
      if (!cur || !prev) return cur;
      future.current.push(cur);
      latest.current = prev;
      return prev;
    });
    schedule();
    bump((x) => x + 1);
  }, [schedule]);

  const redo = useCallback(() => {
    setDoc((cur) => {
      const next = future.current.pop();
      if (!cur || !next) return cur;
      past.current.push(cur);
      latest.current = next;
      return next;
    });
    schedule();
    bump((x) => x + 1);
  }, [schedule]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const editing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key.toLowerCase() === "z" && !e.shiftKey && !editing) {
        e.preventDefault();
        undo();
      } else if ((e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) && !editing) {
        e.preventDefault();
        redo();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        dirty.current = true;
        flush();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [undo, redo, flush]);

  return {
    payload,
    doc,
    error,
    update,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveState,
    sync,
    saveNow: () => {
      dirty.current = true;
      return flush();
    },
  };
}
