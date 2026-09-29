import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Copy, FileSpreadsheet, FileUp, FolderOpen, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { api, ESTATICO } from "../lib/api";
import { go, useApp, useDownloadExcel } from "../lib/app";
import { Empty, Menu, Modal, Segmented } from "../components/ui";
import { CURRENCIES, CURRENCY_CODES, money, relativeTime } from "../../shared/format";
import type { ClientTemplate, CurrencyCode, ProjectSummary } from "../../shared/types";

export function Home() {
  const { toast, rateOf } = useApp();
  const downloadExcel = useDownloadExcel();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<(ClientTemplate & { projects: number })[]>([]);
  const [filter, setFilter] = useState<"all" | "topsite" | "client">("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api.projects().then(setProjects).catch((e) => toast(e.message, "bad"));
    api.templates().then(setTemplates).catch(() => undefined);
  };
  useEffect(load, []);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (projects ?? []).filter(
      (p) => (filter === "all" || p.kind === filter) && (!term || `${p.name} ${p.client ?? ""} ${p.templateName ?? ""}`.toLowerCase().includes(term)),
    );
  }, [projects, filter, q]);

  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const r = await api.importFile(file);
      if (r.type === "project") {
        toast("Planilha importada como orçamento");
        go(`/p/${r.id}`);
      } else {
        toast("Modelo de cliente cadastrado — confira o mapeamento");
        go(`/modelos/${r.id}`);
      }
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <div className="eyebrow">Orçamentos</div>
            <h1 className="h1" style={{ marginTop: 6 }}>Seus orçamentos</h1>
            <div className="muted" style={{ marginTop: 6 }}>
              {ESTATICO ? "Versão online de demonstração: os orçamentos ficam salvos neste navegador. Baixe o Excel quando quiser." : "Cada orçamento é gravado direto na planilha Excel correspondente."}
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing}>
              <FileUp size={16} /> {importing ? "Importando…" : "Importar planilha"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                e.target.value = "";
              }}
            />
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Novo orçamento
            </button>
          </div>
        </div>

        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder="Buscar por projeto ou cliente" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Todos" },
              { value: "topsite", label: "Modelo da empresa" },
              { value: "client", label: "Modelos de clientes" },
            ]}
          />
          <div className="grow" />
          {projects && <span className="small muted">{list.length} de {projects.length}</span>}
        </div>

        {projects === null ? (
          <div className="cards">
            {[0, 1, 2].map((i) => (
              <div key={i} className="pcard" style={{ height: 210, opacity: 0.5 }} />
            ))}
          </div>
        ) : !projects.length ? (
          <div className="card">
            <Empty icon={<FolderOpen size={22} />} title="Nenhum orçamento ainda">
              Crie um orçamento a partir da planilha modelo da empresa ou de um modelo de cliente, ou importe uma planilha existente.
              <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
                <button className="btn primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Novo orçamento
                </button>
              </div>
            </Empty>
          </div>
        ) : (
          <div className="cards">
            {list.map((p) => {
              const rate = p.display === "BRL" ? 1 : p.rate || rateOf(p.display) || 1;
              const max = Math.max(...(p.topGroups ?? []).map((g) => g.value), 1);
              return (
                <a key={p.id} className="pcard" href={p.kind === "topsite" ? `#/p/${p.id}` : `#/c/${p.id}`}>
                  <div className="row between" style={{ alignItems: "flex-start" }}>
                    <div className="grow">
                      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                        {p.kind === "topsite" ? <span className="badge">Modelo da empresa</span> : <span className="badge gold">{p.templateName ?? "Modelo de cliente"}</span>}
                        {p.revision && <span className="badge">{p.revision}</span>}
                      </div>
                      <div className="pcard-title">{p.name}</div>
                      <div className="small muted" style={{ marginTop: 3 }}>{p.client || p.company || "—"}</div>
                    </div>
                    <div onClick={(e) => e.preventDefault()}>
                      <Menu align="right" trigger={(t) => <button className="btn ghost sm icon" {...t} aria-label="Ações"><MoreHorizontal size={16} /></button>}>
                        {(close) => (
                          <>
                            <button className="menu-item" onClick={() => (close(), downloadExcel(p.id))}>
                              <FileSpreadsheet size={15} /> Baixar Excel
                            </button>
                            <button
                              className="menu-item"
                              onClick={async () => {
                                close();
                                await api.duplicate(p.id);
                                toast("Orçamento duplicado");
                                load();
                              }}
                            >
                              <Copy size={15} /> Duplicar
                            </button>
                            <div className="menu-sep" />
                            <button
                              className="menu-item danger"
                              onClick={async () => {
                                close();
                                if (!confirm(ESTATICO ? `Excluir “${p.name}” deste navegador? Esta ação não pode ser desfeita.` : `Mover “${p.name}” para a lixeira? O arquivo fica guardado em data/lixeira.`)) return;
                                await api.deleteProject(p.id);
                                toast("Orçamento movido para a lixeira");
                                load();
                              }}
                            >
                              <Trash2 size={15} /> Excluir
                            </button>
                          </>
                        )}
                      </Menu>
                    </div>
                  </div>
                  <div>
                    <div className="xs muted" style={{ marginBottom: 2 }}>{p.kind === "topsite" ? "Total da proposta" : "Valor final"}</div>
                    <div className="pcard-total num">{money(p.total / rate, p.display)}</div>
                    {p.display !== "BRL" && <div className="xs muted num">{money(p.total)}</div>}
                  </div>
                  {!!p.topGroups?.length && (
                    <div className="mini-bars">
                      {p.topGroups.slice(0, 4).map((g) => (
                        <div key={g.name} className="mini-bar">
                          <span className="lbl" title={g.name}>{g.name}</span>
                          <span className="track"><span className="fill" style={{ width: `${(g.value / max) * 100}%`, display: "block" }} /></span>
                          <span className="num right">{p.sale ? Math.round((g.value / p.sale) * 100) : 0}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.kind === "client" && !!p.totalItems && (
                    <div className="col" style={{ gap: 6 }}>
                      <div className="row between xs muted">
                        <span>Preenchimento</span>
                        <span className="num">{Math.round((p.items / p.totalItems) * 100)}%</span>
                      </div>
                      <div className="progress"><i style={{ width: `${(p.items / p.totalItems) * 100}%` }} /></div>
                    </div>
                  )}
                  <div className="pcard-foot" style={{ marginTop: "auto" }}>
                    <span>{p.items}{p.totalItems ? ` de ${p.totalItems}` : ""} {p.items === 1 ? "item" : "itens"} com preço</span>
                    <span>Editado {relativeTime(p.updatedAt)}</span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
      {creating && <NewProjectModal templates={templates} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProjectModal({ templates, onClose }: { templates: ClientTemplate[]; onClose: () => void }) {
  const { toast, rateOf } = useApp();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [company, setCompany] = useState("TOPSITE ENGINEERING");
  const [model, setModel] = useState<string>("topsite");
  const [display, setDisplay] = useState<CurrencyCode>("BRL");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body =
        model === "topsite"
          ? { kind: "topsite", name: name.trim(), client, company, display, rate: rateOf(display) }
          : { kind: "client", templateId: model, name: name.trim(), client, display, rate: rateOf(display) };
      const p = await api.createProject(body);
      go(p.kind === "topsite" ? `/p/${p.id}` : `/c/${p.id}`);
    } catch (e) {
      toast((e as Error).message, "bad");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Novo orçamento"
      subtitle="Escolha a planilha base. O arquivo Excel é criado e mantido atualizado automaticamente."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>
            {busy ? "Criando…" : "Criar orçamento"}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <div className="field">
          <label>Planilha base</label>
          <div className="col" style={{ gap: 8 }}>
            <button className={`choice ${model === "topsite" ? "on" : ""}`} onClick={() => setModel("topsite")}>
              <span className="ic"><FileSpreadsheet size={17} /></span>
              <span>
                <b>Modelo da empresa</b>
                <div className="small muted">Planilha Custo → Venda → Resumo, com dashboard de apresentação ao cliente.</div>
              </span>
            </button>
            {templates.map((t) => (
              <button key={t.id} className={`choice ${model === t.id ? "on" : ""}`} onClick={() => (setModel(t.id), setClient(t.client))}>
                <span className="ic"><Building2 size={17} /></span>
                <span>
                  <b>{t.name}</b>
                  <div className="small muted">Modelo do cliente {t.client} · {t.sections.length} seções · preenchimento sem alterar a planilha</div>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="np-name">Nome do projeto</label>
          <input id="np-name" className="input" autoFocus placeholder="Ex.: Loja Shopping Centro — Retrofit" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Cliente</label>
            <input className="input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nome do cliente" />
          </div>
          {model === "topsite" ? (
            <div className="field">
              <label>Empresa responsável</label>
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
          ) : (
            <div />
          )}
        </div>
        <div className="field">
          <label>Moeda de apresentação</label>
          <select className="select" value={display} onChange={(e) => setDisplay(e.target.value as CurrencyCode)}>
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c} — {CURRENCIES[c].name}
                {c !== "BRL" && rateOf(c) ? ` (R$ ${rateOf(c).toLocaleString("pt-BR", { maximumFractionDigits: rateOf(c) < 1 ? 5 : 4 })})` : ""}
              </option>
            ))}
          </select>
          <span className="hint">Os custos são lançados em reais; a apresentação converte pela cotação do dia (pode ser fixada depois).</span>
        </div>
      </div>
    </Modal>
  );
}
