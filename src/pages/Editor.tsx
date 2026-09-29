import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, CircleAlert, FileSpreadsheet, Loader2, MonitorPlay, Redo2, Settings2, Sparkles, Table2, Undo2, X } from "lucide-react";
import { useProjectDoc, type SaveState } from "../lib/useProjectDoc";
import { go, useApp, useDownloadExcel } from "../lib/app";
import { ESTATICO } from "../lib/api";
import { Modal } from "../components/ui";
import { Assistant } from "../components/Assistant";
import { CurrencyControl } from "../components/CurrencyControl";
import { BudgetSheet, StructureNav, type SheetOps } from "./BudgetSheet";
import { Inspector } from "./Inspector";
import { Analysis } from "./Analysis";
import { applyTopsiteProposal } from "../lib/proposals";
import { computeBudget, findNode, findParent, insertChild, moveNode, removeNode, uid, updateNode, fromBRL } from "../../shared/calc";
import { matchDiscipline } from "../../shared/catalog";
import { dateBR, money, pct } from "../../shared/format";
import type { BudgetNode, SyncState, TopsiteProject } from "../../shared/types";

export function Editor({ id, tab }: { id: string; tab: "planilha" | "analise" }) {
  const { doc, error, update, undo, redo, canUndo, canRedo, saveState, sync, payload } = useProjectDoc<TopsiteProject>(id);
  const { rateOf, rates, toast } = useApp();
  const downloadExcel = useDownloadExcel();
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"assistant" | "item" | null>(() => (window.innerWidth > 1200 && !ESTATICO ? "assistant" : null));
  const [showParams, setShowParams] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [jumpActive, setJumpActive] = useState<string | null>(null);
  const [askSeed, setAskSeed] = useState<{ text: string; n: number } | null>(null);

  const calc = useMemo(() => (doc ? computeBudget(doc) : null), [doc]);

  // cotação "ao vivo": atualiza uma vez ao abrir
  const liveChecked = useRef(false);
  useEffect(() => {
    if (!doc || !rates.length || liveChecked.current) return;
    liveChecked.current = true;
    const cur = doc.currency;
    if (cur.display !== "BRL" && cur.mode === "live") {
      const r = rateOf(cur.display);
      if (r && Math.abs(r - cur.rate) > 1e-7) update((p) => ({ ...p, currency: { ...p.currency, foreign: cur.display, rate: r, rateAt: new Date().toISOString() } }));
    }
  }, [doc, rates, rateOf, update]);

  useEffect(() => {
    if (payload?.reimported) toast("Alterações feitas direto no Excel foram importadas");
  }, [payload, toast]);

  const ops: SheetOps = useMemo(
    () => ({
      addDiscipline: (name) =>
        update((p) => {
          const roots = p.roots.length ? p.roots : [{ id: uid(), level: 1 as const, description: p.info.name.toUpperCase(), children: [] }];
          const cat = matchDiscipline(name);
          const disc: BudgetNode = {
            id: uid(),
            level: 2,
            description: name,
            children: cat && cat.name === name ? [{ id: uid(), level: 3, description: cat.groups[0].name, children: [] }] : [],
          };
          setTimeout(() => document.getElementById(`row-${disc.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
          return { ...p, roots: insertChild(roots, roots[roots.length - 1].id, disc) };
        }),
      addGroup: (discId, name) => update((p) => ({ ...p, roots: insertChild(p.roots, discId, { id: uid(), level: 3, description: name, children: [] }) })),
      addItem: (groupId, partial) => {
        const item: BudgetNode = { id: uid(), level: 4, description: "", unit: "un", qty: 1, material: null, labor: null, ...partial };
        update((p) => ({ ...p, roots: insertChild(p.roots, groupId, item) }));
        setSelected(item.id);
        if (!partial) setTimeout(() => (document.querySelector(`#row-${item.id} input[data-nav="desc"]`) as HTMLInputElement | null)?.focus(), 30);
        else if (partial.specs?.length) setPanel("item");
      },
      rename: (nid, name) => update((p) => ({ ...p, roots: updateNode(p.roots, nid, { description: name }) })),
      patch: (nid, patch) => update((p) => ({ ...p, roots: updateNode(p.roots, nid, patch) })),
      remove: (nid) => {
        const node = doc && findNode(doc.roots, nid);
        if (node && node.level < 4 && (node.children ?? []).length && !confirm(`Excluir “${node.description}” e tudo o que está dentro?`)) return;
        update((p) => ({ ...p, roots: removeNode(p.roots, nid) }));
        if (selected === nid) setSelected(null);
        toast("Excluído — Ctrl+Z desfaz");
      },
      move: (nid, dir) => update((p) => ({ ...p, roots: moveNode(p.roots, nid, dir) })),
      duplicate: (nid) =>
        update((p) => {
          const node = findNode(p.roots, nid);
          const parent = findParent(p.roots, nid);
          if (!node || !parent) return p;
          const clone = (n: BudgetNode): BudgetNode => ({ ...n, id: uid(), children: n.children?.map(clone) });
          const idx = (parent.children ?? []).findIndex((c) => c.id === nid);
          return { ...p, roots: insertChild(p.roots, parent.id, { ...clone(node), description: node.description + (node.level === 4 ? "" : " (cópia)") }, idx + 1) };
        }),
      select: (nid, open) => {
        setSelected(nid);
        if (open && nid) setPanel("item");
      },
    }),
    [update, doc, selected, toast],
  );

  const find = useCallback((nid: string) => (doc ? findNode(doc.roots, nid) : null), [doc]);

  if (error) return <div className="page"><div className="page-inner"><div className="banner bad">{error}</div></div></div>;
  if (!doc || !calc) return <div className="page"><div className="page-inner muted"><Loader2 size={16} className="spin" /> Abrindo orçamento…</div></div>;

  const selectedNode = selected ? findNode(doc.roots, selected) : null;
  const warnings = (doc.warnings ?? []).filter((w) => !dismissed.includes(w));
  const displayRate = doc.currency.display === "BRL" ? 1 : doc.currency.rate;

  return (
    <div className="editor">
      <header className="ehead">
        <div className="ehead-top">
          <button className="btn ghost sm icon" onClick={() => go("/")} aria-label="Voltar">
            <ArrowLeft size={16} />
          </button>
          <div className="grow">
            <input className="ehead-title" value={doc.info.name} size={Math.max(12, doc.info.name.length)} onChange={(e) => update((p) => ({ ...p, info: { ...p.info, name: e.target.value } }))} aria-label="Nome do projeto" />
            <div className="ehead-meta">
              <span>{doc.info.client || "Cliente não informado"}</span>·<span>{doc.info.company}</span>·<span>{doc.info.revision}</span>·<span>{dateBR(doc.info.date)}</span>
              {doc.info.area ? <>·<span>{doc.info.area.toLocaleString("pt-BR")} m²</span></> : null}
            </div>
          </div>
          <SaveBadge state={saveState} sync={sync} />
          <div className="row" style={{ gap: 2 }}>
            <button className="btn ghost sm icon" title="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
              <Undo2 size={15} />
            </button>
            <button className="btn ghost sm icon" title="Refazer (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
              <Redo2 size={15} />
            </button>
          </div>
          <CurrencyControl value={doc.currency} onChange={(c) => update((p) => ({ ...p, currency: c }))} />
          <button className="btn sm" onClick={() => setShowParams(true)}>
            <Settings2 size={14} /> Parâmetros
          </button>
          <button className="btn sm" onClick={() => downloadExcel(doc.id)} title={sync?.excelFile}>
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button className={`btn sm ${panel === "assistant" ? "primary" : ""}`} onClick={() => setPanel(panel === "assistant" ? null : "assistant")}>
            <Sparkles size={14} /> Assistente
          </button>
        </div>
        <nav className="tabs">
          <a className={`tab ${tab === "planilha" ? "on" : ""}`} href={`#/p/${doc.id}`}>
            <Table2 size={15} /> Planilha
          </a>
          <a className={`tab ${tab === "analise" ? "on" : ""}`} href={`#/p/${doc.id}/analise`}>
            <BarChart3 size={15} /> Visão geral
          </a>
          <a className="tab" href={`#/p/${doc.id}/apresentacao`}>
            <MonitorPlay size={15} /> Apresentação ao cliente
          </a>
        </nav>
      </header>

      {warnings.map((w) => (
        <div key={w} className="banner warn" style={{ margin: "10px 16px 0", borderRadius: 10 }}>
          <AlertTriangle size={16} />
          <div className="grow">{w}</div>
          <button className="btn ghost xs icon" onClick={() => setDismissed((d) => [...d, w])} aria-label="Dispensar">
            <X size={13} />
          </button>
        </div>
      ))}
      {sync?.lastError && (
        <div className="banner bad" style={{ margin: "10px 16px 0" }}>
          <CircleAlert size={16} />
          <div className="grow">{sync.lastError}</div>
        </div>
      )}

      <div className="ebody">
        {tab === "planilha" ? (
          <>
            <StructureNav
              project={doc}
              calc={calc}
              active={jumpActive}
              onJump={(nid) => {
                const n = findNode(doc.roots, nid);
                if (n?.level === 2) setJumpActive(jumpActive === nid ? null : nid);
                document.getElementById(`row-${nid}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
            <BudgetSheet
              project={doc}
              calc={calc}
              ops={ops}
              selected={selected}
              rateOf={rateOf}
              onAskAI={(text) => {
                setPanel("assistant");
                setAskSeed({ text, n: Date.now() });
              }}
            />
          </>
        ) : (
          <div className="page" style={{ background: "var(--page)" }}>
            <Analysis project={doc} calc={calc} onOpenItem={(nid) => (go(`/p/${doc.id}`), setTimeout(() => ops.select(nid, true), 50))} />
          </div>
        )}
        {panel === "item" && selectedNode?.level === 4 && (
          <Inspector project={doc} node={selectedNode} calc={calc} ops={ops} rateOf={rateOf} onClose={() => setPanel("assistant")} />
        )}
        {panel !== null && (
          // o assistente continua montado por baixo do painel do item (não perde a conversa em andamento)
          <div style={{ display: panel === "item" && selectedNode?.level === 4 ? "none" : "contents" }}>
            <Assistant key={doc.id + (askSeed?.n ?? "")} project={doc} find={find} onApply={(prop) => update((p) => applyTopsiteProposal(p, prop, rateOf))} onClose={() => setPanel(null)} seed={askSeed?.text} />
          </div>
        )}
      </div>

      <footer className="summary">
        <SumItem k="Custo direto" v={money(calc.cost)} />
        <SumItem k={`BDI ${pct(doc.params.bdi, 1)}`} v={money(calc.sale - calc.cost)} />
        <SumItem k="Preço de venda" v={money(calc.sale)} />
        <SumItem k={`${doc.params.adminLabel} ${pct(doc.params.admin, 1)}`} v={money(calc.admin)} />
        <SumItem k={`${shortLabel(doc.params.taxLabel)} ${pct(doc.params.tax, 2)}`} v={money(calc.tax)} />
        <div className="sum-item total">
          <span className="k">Total da proposta</span>
          <span className="v">{money(fromBRL(calc.total, displayRate), doc.currency.display)}</span>
          {doc.currency.display !== "BRL" && <span className="alt">{money(calc.total)}</span>}
        </div>
      </footer>

      {showParams && <ParamsModal project={doc} onClose={() => setShowParams(false)} onSave={(p) => update(() => p)} />}
    </div>
  );
}

const shortLabel = (s: string) => (s.length > 18 ? s.split(/\s+-\s+|\s+—\s+/)[0] : s);

function SumItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="sum-item">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

export function SaveBadge({ state, sync }: { state: SaveState; sync?: SyncState }) {
  if (state === "saving" || state === "pending")
    return (
      <span className="save-state">
        <Loader2 size={13} className="spin" /> {state === "saving" ? (ESTATICO ? "Salvando…" : "Gravando no Excel…") : "Alterações pendentes"}
      </span>
    );
  if (state === "error" || sync?.lastError)
    return (
      <span className="save-state err" title={sync?.lastError ?? ""}>
        <CircleAlert size={13} /> Excel não atualizado
      </span>
    );
  return (
    <span className="save-state" title={sync?.excelFile}>
      <CheckCircle2 size={13} color="var(--good)" />
      {sync?.lastExcelWrite ? `${ESTATICO ? "Salvo neste navegador" : "Salvo no Excel"} às ${new Date(sync.lastExcelWrite).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ESTATICO ? "Salvo neste navegador" : "Sincronizado com o Excel"}
    </span>
  );
}

function ParamsModal({ project, onClose, onSave }: { project: TopsiteProject; onClose: () => void; onSave: (p: TopsiteProject) => void }) {
  const [info, setInfo] = useState(project.info);
  const [params, setParams] = useState(project.params);
  const pctIn = (v: number) => (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  const pctOut = (s: string) => {
    const v = parseFloat(s.replace(",", "."));
    return isFinite(v) ? v / 100 : 0;
  };
  return (
    <Modal
      title="Parâmetros do orçamento"
      subtitle="Estes campos são gravados nas abas Resumo e Venda da planilha."
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn primary"
            onClick={() => {
              onSave({ ...project, info, params });
              onClose();
            }}
          >
            Salvar parâmetros
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 18 }}>
        <div>
          <div className="section-title">Projeto</div>
          <div className="grid2">
            <div className="field">
              <label>Nome do projeto (Resumo E1)</label>
              <input className="input" value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Cliente</label>
              <input className="input" value={info.client ?? ""} onChange={(e) => setInfo({ ...info, client: e.target.value })} />
            </div>
            <div className="field">
              <label>Empresa responsável (Resumo D4)</label>
              <input className="input" value={info.company} onChange={(e) => setInfo({ ...info, company: e.target.value })} />
            </div>
            <div className="field">
              <label>Local</label>
              <input className="input" value={info.location ?? ""} placeholder="Ex.: Shopping Centro · São Paulo" onChange={(e) => setInfo({ ...info, location: e.target.value })} />
            </div>
          </div>
          <div className="grid3" style={{ marginTop: 14 }}>
            <div className="field">
              <label>Data (Resumo E4)</label>
              <input className="input" type="date" value={info.date ?? ""} onChange={(e) => setInfo({ ...info, date: e.target.value })} />
            </div>
            <div className="field">
              <label>Revisão (Resumo G4)</label>
              <input className="input" value={info.revision} onChange={(e) => setInfo({ ...info, revision: e.target.value })} />
            </div>
            <div className="field">
              <label>Área (m²)</label>
              <input className="input" inputMode="decimal" value={info.area ?? ""} onChange={(e) => setInfo({ ...info, area: e.target.value ? parseFloat(e.target.value.replace(",", ".")) || null : null })} />
            </div>
          </div>
        </div>
        <div>
          <div className="section-title">Comercial</div>
          <div className="grid3">
            <div className="field">
              <label>BDI global (Venda AK1)</label>
              <div className="input-affix">
                <input className="input" defaultValue={pctIn(params.bdi)} onBlur={(e) => setParams({ ...params, bdi: pctOut(e.target.value) })} />
                <span className="affix">%</span>
              </div>
            </div>
            <div className="field">
              <label>Administração (Resumo K163)</label>
              <div className="input-affix">
                <input className="input" defaultValue={pctIn(params.admin)} onBlur={(e) => setParams({ ...params, admin: pctOut(e.target.value) })} />
                <span className="affix">%</span>
              </div>
            </div>
            <div className="field">
              <label>Imposto (Resumo K164)</label>
              <div className="input-affix">
                <input className="input" defaultValue={pctIn(params.tax)} onBlur={(e) => setParams({ ...params, tax: pctOut(e.target.value) })} />
                <span className="affix">%</span>
              </div>
            </div>
          </div>
          <div className="grid2" style={{ marginTop: 14 }}>
            <div className="field">
              <label>Rótulo da administração</label>
              <input className="input" value={params.adminLabel} onChange={(e) => setParams({ ...params, adminLabel: e.target.value })} />
            </div>
            <div className="field">
              <label>Rótulo do imposto</label>
              <input className="input" value={params.taxLabel} onChange={(e) => setParams({ ...params, taxLabel: e.target.value })} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Nível de detalhe do Resumo (K3)</label>
            <select className="select" style={{ width: 280 }} value={params.summaryLevel} onChange={(e) => setParams({ ...params, summaryLevel: Number(e.target.value) })}>
              <option value={1}>Até disciplinas (nível 2)</option>
              <option value={2}>Até grupos (nível 3)</option>
              <option value={3}>Até itens (nível 4)</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Observações da proposta (Resumo — OBS.)</label>
          <textarea className="textarea" value={info.notes ?? ""} onChange={(e) => setInfo({ ...info, notes: e.target.value })} placeholder="Validade da proposta, condições de pagamento, prazo de execução…" />
        </div>
      </div>
    </Modal>
  );
}
