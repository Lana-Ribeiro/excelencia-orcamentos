import type { AnyProject, ChatTurn, ClientTemplate, FxRate, ProjectSummary, Proposal, SyncState } from "../../shared/types";
import type { EvalCell } from "../../shared/formula";
import { localApi } from "./local/localApi";

/** Versão online (site estático): tudo roda no navegador, sem servidor. */
export const ESTATICO = import.meta.env.VITE_ESTATICO === "1";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  if (res.status === 401) window.location.reload(); // sessão expirada: volta para a tela de senha
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

export interface ProjectPayload {
  project: AnyProject;
  reimported: boolean;
  template?: ClientTemplate;
  cells?: Record<string, EvalCell>;
}

const httpApi = {
  health: () => req<{ ok: boolean; ai: { configured: boolean; model: string } }>("/api/health"),
  fx: (force = false) => req<{ rates: FxRate[]; offline: boolean }>(`/api/fx${force ? "?force=1" : ""}`),
  projects: () => req<ProjectSummary[]>("/api/projects"),
  project: (id: string) => req<ProjectPayload>(`/api/projects/${id}`),
  createProject: (body: Record<string, unknown>) => req<AnyProject>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  saveProject: (p: AnyProject) => req<{ sync: SyncState }>(`/api/projects/${p.id}`, { method: "PUT", body: JSON.stringify(p) }),
  duplicate: (id: string) => req<AnyProject>(`/api/projects/${id}/duplicate`, { method: "POST" }),
  deleteProject: (id: string) => req<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
  downloadExcel: async (id: string) => {
    window.location.href = `/api/projects/${id}/excel`;
  },
  templates: () => req<(ClientTemplate & { projects: number })[]>("/api/templates"),
  template: (id: string) => req<{ template: ClientTemplate; cells: Record<string, EvalCell> }>(`/api/templates/${id}`),
  updateTemplate: (id: string, body: Record<string, unknown>) => req<ClientTemplate>(`/api/templates/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTemplate: (id: string) => req<{ ok: true }>(`/api/templates/${id}`, { method: "DELETE" }),
  importFile: (file: File, meta: { templateName?: string; client?: string } = {}) =>
    req<{ type: "project" | "template"; id: string; warnings?: string[] }>("/api/import", {
      method: "POST",
      body: file,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        ...(meta.templateName ? { "X-Template-Name": encodeURIComponent(meta.templateName) } : {}),
        ...(meta.client ? { "X-Client": encodeURIComponent(meta.client) } : {}),
      },
    }),
};

export const api: typeof httpApi = ESTATICO ? localApi : httpApi;

export interface StreamHandlers {
  onText?: (delta: string) => void;
  onProposal?: (p: Proposal) => void;
  onDone?: (data: { proposals?: number }) => void;
  onError?: (message: string) => void;
}

/** Lê um fluxo SSE de uma requisição POST. */
export async function streamPost(url: string, body: unknown, h: StreamHandlers, signal?: AbortSignal) {
  if (ESTATICO) {
    h.onError?.("O assistente de IA não está disponível na versão online de demonstração. Ele funciona na versão instalada no computador, com a chave da API configurada.");
    return;
  }
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error).name !== "AbortError") h.onError?.("Não foi possível conectar ao servidor local.");
    return;
  }
  if (res.status === 401) window.location.reload();
  if (!res.ok || !res.body) {
    const t = await res.text();
    let msg = t;
    try {
      msg = JSON.parse(t).error;
    } catch {
      /* texto puro */
    }
    h.onError?.(msg || `Erro ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (!ev || data === undefined) continue;
        const parsed = JSON.parse(data);
        if (ev === "text") h.onText?.(parsed.delta);
        else if (ev === "proposal") h.onProposal?.(parsed);
        else if (ev === "done") h.onDone?.(parsed);
        else if (ev === "error") h.onError?.(parsed.message);
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") h.onError?.("A conexão foi interrompida.");
  }
}

export type { ChatTurn };

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
