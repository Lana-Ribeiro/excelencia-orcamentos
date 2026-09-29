import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, FileSpreadsheet, FileText, Image as ImageIcon, KeyRound, ListPlus, Paperclip, Pencil, Settings2, Sparkles, Square, Trash2, Undo2, X } from "lucide-react";
import { ESTATICO, fileToBase64, streamPost } from "../lib/api";
import { useApp } from "../lib/app";
import { Markdown } from "./ui";
import { describeProposal } from "../lib/proposals";
import type { AnyProject, BudgetNode, ClientTemplate, Proposal } from "../../shared/types";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  files?: string[];
  proposals?: { p: Proposal; status: "pending" | "applied" | "dismissed" }[];
  error?: string;
  streaming?: boolean;
}

interface Pending {
  name: string;
  type: string;
  data: string;
  size: number;
}

const MAX_FILE = 15 * 1024 * 1024;

export function Assistant({
  project,
  template,
  find,
  onApply,
  onClose,
  seed,
}: {
  project: AnyProject;
  template?: ClientTemplate;
  find?: (id: string) => BudgetNode | null;
  onApply: (p: Proposal) => void;
  onClose?: () => void;
  seed?: string;
}) {
  const { ai, toast } = useApp();
  const storeKey = `chat:${project.id}`;
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? "[]").map((m: Msg) => ({ ...m, streaming: false }));
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState(seed ?? "");
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(msgs.slice(-60)));
    } catch {
      /* armazenamento indisponível */
    }
  }, [msgs, storeKey]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const addFiles = async (list: FileList | File[]) => {
    const arr = [...list];
    for (const f of arr) {
      if (f.size > MAX_FILE) {
        toast(`${f.name} passa de 15 MB`, "bad");
        continue;
      }
      const type = f.type || (/\.xlsx$/i.test(f.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/plain");
      const data = await fileToBase64(f);
      setFiles((cur) => [...cur, { name: f.name, type, data, size: f.size }]);
    }
  };

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if ((!text && !files.length) || busy) return;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text: text || "Analise o anexo.", files: files.map((f) => f.name) };
    const botMsg: Msg = { id: crypto.randomUUID(), role: "assistant", text: "", proposals: [], streaming: true };
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text + (m.proposals?.length ? `\n[${m.proposals.length} proposta(s) enviadas]` : "") }));
    setMsgs((cur) => [...cur, userMsg, botMsg]);
    setInput("");
    const attachments = files.map(({ name, type, data }) => ({ name, type, data }));
    setFiles([]);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patchBot = (fn: (m: Msg) => Msg) => setMsgs((cur) => cur.map((m) => (m.id === botMsg.id ? fn(m) : m)));
    await streamPost(
      "/api/ai/chat",
      { projectId: project.id, project: projectRef.current, history, message: userMsg.text, attachments },
      {
        onText: (d) => patchBot((m) => ({ ...m, text: m.text + d })),
        onProposal: (p) => patchBot((m) => ({ ...m, proposals: [...(m.proposals ?? []), { p, status: "pending" }] })),
        onError: (e) => patchBot((m) => ({ ...m, error: e })),
      },
      ctrl.signal,
    );
    patchBot((m) => ({ ...m, streaming: false }));
    setBusy(false);
    abort.current = null;
  };

  const setStatus = (msgId: string, pid: string, status: "applied" | "dismissed") =>
    setMsgs((cur) => cur.map((m) => (m.id === msgId ? { ...m, proposals: m.proposals?.map((x) => (x.p.id === pid ? { ...x, status } : x)) } : m)));

  const apply = (msgId: string, prop: Proposal) => {
    onApply(prop);
    setStatus(msgId, prop.id, "applied");
  };

  const quick =
    project.kind === "topsite"
      ? [
          { label: "Lançar cotação de fornecedor", prompt: "Vou colar/anexar a cotação de um fornecedor. Extraia os itens com quantidades, preços de material e mão de obra, e proponha onde lançar:" },
          { label: "Sugerir itens para uma disciplina", prompt: "Sugira a estrutura de grupos e itens típicos para a disciplina de " },
          { label: "Que especificações faltam?", prompt: "Revise os itens e liste as especificações técnicas que ainda faltam levantar (cores, referências, bitolas, marcas etc.), por disciplina." },
          { label: "Revisar o orçamento", prompt: "Revise o orçamento: aponte itens sem preço, quantidades suspeitas, premissas ausentes e o que costuma faltar neste tipo de obra." },
        ]
      : [
          { label: "Preencher a partir de uma cotação", prompt: "Vou colar/anexar uma cotação. Preencha as linhas correspondentes da planilha do cliente:" },
          { label: "O que falta preencher?", prompt: "Quais linhas e campos ainda estão sem preço ou quantidade? Agrupe por seção." },
          { label: "Revisar valores", prompt: "Revise os valores preenchidos e aponte inconsistências ou riscos." },
        ];

  const describeCtx = { find, template };
  const aiOff = ai && !ai.configured;

  return (
    <div
      className={`side ${dragging ? "dropping" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div className="side-head">
        <div className="row">
          <Sparkles size={16} />
          <div>
            <div className="h3">Assistente</div>
            <div className="xs muted">{ESTATICO ? "Desligado na versão online" : ai?.configured ? `Claude · ${ai.model}` : "IA · sem chave configurada"}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          {msgs.length > 0 && (
            <button className="btn ghost sm icon" title="Nova conversa" onClick={() => setMsgs([])}>
              <Trash2 size={15} />
            </button>
          )}
          {onClose && (
            <button className="btn ghost sm icon" title="Fechar assistente" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="chat" ref={scroller}>
        {ESTATICO && (
          <div className="banner info">
            <KeyRound size={16} />
            <div>
              <b>Assistente de IA desligado nesta versão online</b>
              <div className="small" style={{ marginTop: 3 }}>
                Na versão de demonstração a IA não está ativa. Na versão instalada no computador, com a chave da API, o assistente lê cotações (PDF, foto, planilha) e propõe os lançamentos.
              </div>
            </div>
          </div>
        )}
        {aiOff && !ESTATICO && (
          <div className="banner info">
            <KeyRound size={16} />
            <div>
              <b>Ative o assistente de IA</b>
              <div className="small" style={{ marginTop: 3 }}>
                Falta configurar a chave da API da Anthropic (<code>ANTHROPIC_API_KEY</code>): no computador, no arquivo <code>.env</code>; na nuvem, nos segredos do servidor. Todo o resto funciona sem a IA.
              </div>
            </div>
          </div>
        )}
        {!msgs.length && (
          <div className="col" style={{ gap: 14, marginTop: 6 }}>
            <div>
              <div className="h3" style={{ fontSize: 15 }}>Como posso ajudar neste orçamento?</div>
              <div className="small muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
                {project.kind === "topsite"
                  ? "Cole ou anexe cotações (PDF, foto, planilha) e eu organizo os itens, preços e especificações na estrutura. Você revisa cada proposta antes de aplicar."
                  : "Cole ou anexe cotações e eu preencho as linhas certas da planilha do cliente, sem alterar o modelo. Você revisa antes de aplicar."}
              </div>
            </div>
            <div className="col" style={{ gap: 6 }}>
              {quick.map((q) => (
                <button
                  key={q.label}
                  className="choice"
                  style={{ padding: "10px 12px", alignItems: "center" }}
                  onClick={() => {
                    setInput(q.prompt);
                    textarea.current?.focus();
                  }}
                >
                  <span className="small" style={{ fontWeight: 560 }}>{q.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className="col" style={{ gap: 8 }}>
            {m.role === "user" ? (
              <div className="msg user">
                {!!m.files?.length && (
                  <div>
                    {m.files.map((f) => (
                      <span key={f} className="att">
                        <Paperclip size={11} /> {f}
                      </span>
                    ))}
                  </div>
                )}
                {m.text}
              </div>
            ) : (
              <div className="msg assistant">
                {m.text ? <Markdown text={m.text} /> : m.streaming && !m.proposals?.length ? <span className="thinking"><i /><i /><i /> analisando</span> : null}
                {m.error && (
                  <div className="banner bad" style={{ marginTop: 6 }}>
                    <X size={15} />
                    <div className="small">{m.error}</div>
                  </div>
                )}
              </div>
            )}
            {!!m.proposals?.length && (
              <div className="col" style={{ gap: 8 }}>
                {m.proposals.map(({ p, status }) => {
                  const view = describeProposal(p, describeCtx);
                  const Icon = p.type === "add_items" ? ListPlus : p.type === "remove_item" ? Trash2 : p.type === "set_params" ? Settings2 : Pencil;
                  return (
                    <div key={p.id} className={`proposal ${status}`} style={status === "dismissed" ? { opacity: 0.45 } : undefined}>
                      <div className="proposal-head">
                        <div className="ic">{status === "applied" ? <Check size={14} /> : <Icon size={14} />}</div>
                        <div className="grow">
                          <div className="small" style={{ fontWeight: 620, lineHeight: 1.35 }}>{view.title}</div>
                          {p.note && <div className="xs muted" style={{ marginTop: 2 }}>{p.note}</div>}
                        </div>
                      </div>
                      {!!view.lines.length && (
                        <div className="proposal-body">
                          {view.lines.slice(0, 8).map(([k, v], i) => (
                            <div key={i} className="proposal-line">
                              <span>{k}</span>
                              <span>{v}</span>
                            </div>
                          ))}
                          {view.lines.length > 8 && <div className="xs muted">+ {view.lines.length - 8} linhas</div>}
                        </div>
                      )}
                      {status === "pending" && (
                        <div className="proposal-foot">
                          <button className="btn ghost xs" onClick={() => setStatus(m.id, p.id, "dismissed")}>Descartar</button>
                          <button className="btn primary xs" onClick={() => apply(m.id, p)}>
                            <Check size={13} /> Aplicar
                          </button>
                        </div>
                      )}
                      {status !== "pending" && (
                        <div className="proposal-foot" style={{ justifyContent: "space-between" }}>
                          <span className="xs muted">{status === "applied" ? "Aplicada — use Ctrl+Z para desfazer" : "Descartada"}</span>
                          {status === "dismissed" && (
                            <button className="btn ghost xs" onClick={() => apply(m.id, p)}>
                              <Undo2 size={12} /> Aplicar mesmo assim
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {m.proposals.filter((x) => x.status === "pending").length > 1 && !m.streaming && (
                  <button
                    className="btn sm"
                    onClick={() => m.proposals!.filter((x) => x.status === "pending").forEach((x) => apply(m.id, x.p))}
                  >
                    <Check size={14} /> Aplicar todas ({m.proposals.filter((x) => x.status === "pending").length})
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        {!!files.length && (
          <div className="quick">
            {files.map((f, i) => (
              <span key={i} className="chip">
                {/pdf/.test(f.type) ? <FileText size={12} /> : /image/.test(f.type) ? <ImageIcon size={12} /> : <FileSpreadsheet size={12} />}
                {f.name.length > 26 ? f.name.slice(0, 24) + "…" : f.name}
                <button className="btn ghost xs icon" style={{ width: 16, height: 16 }} onClick={() => setFiles((c) => c.filter((_, j) => j !== i))} aria-label="Remover anexo">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-box">
          <textarea
            ref={textarea}
            value={input}
            rows={2}
            placeholder={project.kind === "topsite" ? "Ex.: o fornecedor cotou piso vinílico a R$ 180/m² + R$ 35 de instalação, 120 m²" : "Ex.: preencha demolição de piso a R$ 38/m² e forro a R$ 45/m²"}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-actions">
            <div className="row" style={{ gap: 2 }}>
              <button className="btn ghost sm icon" title="Anexar cotação (PDF, imagem, planilha)" onClick={() => fileInput.current?.click()}>
                <Paperclip size={16} />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xlsm,.csv,.txt"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <span className="xs muted">Enter envia · Shift+Enter quebra linha</span>
            </div>
            {busy ? (
              <button className="btn sm icon" title="Parar" onClick={() => abort.current?.abort()}>
                <Square size={13} />
              </button>
            ) : (
              <button className="btn primary sm icon" title="Enviar" disabled={!input.trim() && !files.length} onClick={() => send()}>
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
