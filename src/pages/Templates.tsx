import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Building2, FileUp, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { go, useApp } from "../lib/app";
import { Empty, Modal } from "../components/ui";
import { relativeTime } from "../../shared/format";
import type { ClientColumnKey, ClientColumns, ClientTemplate } from "../../shared/types";
import type { EvalCell } from "../../shared/formula";

const COL_LABELS: Record<ClientColumnKey, string> = {
  code: "Código do item",
  desc: "Descrição / atividade",
  qty: "Quantidade",
  unit: "Unidade",
  unitPrice: "Preço unitário",
  total: "Total",
  applicable: "Aplicável?",
  obs: "Observações",
};

export function Templates() {
  const { toast } = useApp();
  const [list, setList] = useState<(ClientTemplate & { projects: number })[] | null>(null);
  const [uploading, setUploading] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api.templates().then(setList).catch((e) => toast(e.message, "bad"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <div className="eyebrow">Modelos de clientes</div>
            <h1 className="h1" style={{ marginTop: 6 }}>Planilhas dos clientes</h1>
            <div className="muted" style={{ marginTop: 6, maxWidth: 640 }}>
              Cadastre a planilha padrão que um cliente envia. A ferramenta reconhece seções, itens e campos, e preenche só as células de entrada — o modelo do cliente não é alterado.
            </div>
          </div>
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            <Plus size={16} /> Cadastrar modelo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setUploading(f);
              e.target.value = "";
            }}
          />
        </div>

        <div
          className={`dropzone ${over ? "over" : ""}`}
          style={{ marginBottom: 20 }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) setUploading(f);
          }}
        >
          <FileUp size={20} style={{ marginBottom: 6 }} />
          <div style={{ fontWeight: 560 }}>Arraste a planilha do cliente aqui</div>
          <div className="small muted">.xlsx ou .xlsm · o arquivo original fica guardado intacto</div>
        </div>

        {list && !list.length && (
          <div className="card">
            <Empty icon={<Building2 size={22} />} title="Nenhum modelo cadastrado">Cadastre a planilha que o cliente envia para que os orçamentos dele sejam preenchidos pela ferramenta.</Empty>
          </div>
        )}
        <div className="cards">
          {list?.map((t) => {
            const items = t.sections.reduce((s, x) => s + x.items.length, 0);
            return (
              <a key={t.id} className="pcard" href={`#/modelos/${t.id}`}>
                <div>
                  <span className="badge gold">{t.client || "Cliente"}</span>
                  <div className="pcard-title" style={{ marginTop: 8 }}>{t.name}</div>
                  <div className="small muted" style={{ marginTop: 3 }}>{t.fileName} · aba “{t.sheet}”</div>
                </div>
                <div className="row" style={{ gap: 18 }}>
                  <div>
                    <div className="pcard-total">{t.sections.length}</div>
                    <div className="xs muted">seções</div>
                  </div>
                  <div>
                    <div className="pcard-total">{items}</div>
                    <div className="xs muted">itens</div>
                  </div>
                  <div>
                    <div className="pcard-total">{t.fields.length + t.params.length}</div>
                    <div className="xs muted">campos</div>
                  </div>
                </div>
                <div className="pcard-foot">
                  <span>{t.projects} {t.projects === 1 ? "orçamento" : "orçamentos"}</span>
                  <span>Atualizado {relativeTime(t.updatedAt)}</span>
                </div>
              </a>
            );
          })}
        </div>
      </div>
      {uploading && <UploadModal file={uploading} onClose={() => setUploading(null)} />}
    </div>
  );
}

function UploadModal({ file, onClose }: { file: File; onClose: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState(file.name.replace(/\.(xlsx|xlsm)$/i, ""));
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Cadastrar modelo de cliente"
      subtitle={file.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.importFile(file, { templateName: name.trim(), client: client.trim() });
                if (r.type === "project") {
                  toast("Esta planilha é do modelo da empresa — importada como orçamento");
                  go(`/p/${r.id}`);
                } else go(`/modelos/${r.id}`);
              } catch (e) {
                toast((e as Error).message, "bad");
                setBusy(false);
              }
            }}
          >
            {busy ? "Analisando planilha…" : "Cadastrar e revisar"}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="field">
          <label>Cliente</label>
          <input className="input" autoFocus value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nome do cliente" />
        </div>
        <div className="field">
          <label>Nome do modelo</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export function TemplateDetail({ id }: { id: string }) {
  const { toast } = useApp();
  const [data, setData] = useState<{ template: ClientTemplate; cells: Record<string, EvalCell> } | null>(null);
  const [cols, setCols] = useState<ClientColumns>({});
  const [headerRow, setHeaderRow] = useState(1);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = () =>
    api.template(id).then((d) => {
      setData(d);
      setCols(d.template.columns);
      setHeaderRow(d.template.headerRow);
      setName(d.template.name);
      setClient(d.template.client);
    });
  useEffect(() => {
    load().catch((e) => toast(e.message, "bad"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const grid = useMemo(() => {
    if (!data) return null;
    let maxRow = 0,
      maxCol = 0;
    for (const ref of Object.keys(data.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
      maxRow = Math.max(maxRow, +m[2]);
      maxCol = Math.max(maxCol, colNum(m[1]));
    }
    return { maxRow: Math.min(maxRow, 400), maxCol: Math.min(maxCol, 16) };
  }, [data]);

  if (!data || !grid) return <div className="page"><div className="page-inner muted">Carregando modelo…</div></div>;
  const t = data.template;
  const itemRows = new Set(t.sections.flatMap((s) => s.items.map((i) => i.row)));
  const sectionRows = new Set(t.sections.map((s) => s.row));
  const footerFrom = t.grandTotalCell ? +t.grandTotalCell.replace(/^[A-Z]+/, "") : Infinity;
  const inputCols = new Set([cols.qty, cols.unit, cols.unitPrice, cols.applicable, cols.obs].filter(Boolean) as string[]);
  const colRole = new Map(Object.entries(cols).map(([k, v]) => [v, k as ClientColumnKey]));
  const fieldCells = new Set([...t.fields, ...t.params].map((f) => f.cell));
  const letters = Array.from({ length: grid.maxCol }, (_, i) => colLetter(i + 1));
  const dirty = JSON.stringify(cols) !== JSON.stringify(t.columns) || headerRow !== t.headerRow || name !== t.name || client !== t.client;

  const save = async () => {
    setBusy(true);
    try {
      const mappingChanged = JSON.stringify(cols) !== JSON.stringify(t.columns) || headerRow !== t.headerRow;
      await api.updateTemplate(id, { name, client, ...(mappingChanged ? { columns: cols, headerRow } : {}) });
      await load();
      toast("Modelo atualizado");
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 1400 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <button className="btn ghost sm" onClick={() => go("/modelos")}>
            <ArrowLeft size={15} /> Modelos
          </button>
          <div className="grow" />
          <button
            className="btn ghost sm danger"
            onClick={async () => {
              if (!confirm("Remover este modelo? Os orçamentos já criados continuam com seus arquivos.")) return;
              await api.deleteTemplate(id);
              go("/modelos");
            }}
          >
            <Trash2 size={14} /> Remover
          </button>
          <button className="btn sm" disabled={!dirty || busy} onClick={save}>
            <Save size={14} /> {busy ? "Reprocessando…" : "Salvar mapeamento"}
          </button>
          <button className="btn primary sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Novo orçamento com este modelo
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <div className="col" style={{ gap: 16 }}>
            <div className="card card-pad col" style={{ gap: 12 }}>
              <div className="field">
                <label>Nome do modelo</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>Cliente</label>
                <input className="input" value={client} onChange={(e) => setClient(e.target.value)} />
              </div>
              <div className="small muted">
                Arquivo <b style={{ color: "var(--ink)" }}>{t.fileName}</b> · aba “{t.sheet}”
              </div>
            </div>
            <div className="card card-pad col" style={{ gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Mapeamento das colunas</div>
              <div className="field">
                <label>Linha do cabeçalho</label>
                <input className="input" type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value)))} />
              </div>
              {(Object.keys(COL_LABELS) as ClientColumnKey[]).map((k) => (
                <div key={k} className="row" style={{ gap: 10 }}>
                  <span className="small grow">{COL_LABELS[k]}</span>
                  <select className="select" style={{ width: 96, height: 30 }} value={cols[k] ?? ""} onChange={(e) => setCols({ ...cols, [k]: e.target.value || undefined })}>
                    <option value="">—</option>
                    {letters.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="card card-pad col" style={{ gap: 8 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Reconhecido</div>
              <div className="kv">
                <span className="k">Seções</span><span className="v">{t.sections.length}</span>
                <span className="k">Itens</span><span className="v">{itemRows.size}</span>
                <span className="k">Campos do cabeçalho</span><span className="v">{t.fields.length}</span>
                <span className="k">Parâmetros do rodapé</span><span className="v">{t.params.length}</span>
                <span className="k">Resultados calculados</span><span className="v">{t.outputs.length}</span>
              </div>
              {!!t.warnings?.length && (
                <div className="banner warn" style={{ marginTop: 6 }}>
                  <AlertTriangle size={15} />
                  <div className="small">
                    {t.warnings.slice(0, 3).map((w) => (
                      <div key={w}>{w}</div>
                    ))}
                    {t.warnings.length > 3 && <div>+ {t.warnings.length - 3} avisos semelhantes</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col" style={{ gap: 10 }}>
            <div className="legend-map">
              <span><i style={{ background: "#fff4d6" }} />Cabeçalho</span>
              <span><i style={{ background: "#eef3fa" }} />Seção</span>
              <span><i style={{ background: "#f1faf2" }} />Célula que a ferramenta preenche</span>
              <span><i style={{ background: "#f7f5f0" }} />Rodapé (totais e taxas)</span>
              <span style={{ color: "var(--series-1)" }}>azul = fórmula do cliente (preservada)</span>
            </div>
            <div className="mapgrid-wrap">
              <table className="mapgrid">
                <thead>
                  <tr>
                    <th className="rh" />
                    {letters.map((l) => (
                      <th key={l}>
                        {l}
                        {colRole.get(l) && <span className="colchip">{COL_LABELS[colRole.get(l)!].split(" ")[0]}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: grid.maxRow }, (_, i) => i + 1).map((r) => {
                    const cls = r === t.headerRow ? "hdr" : sectionRows.has(r) ? "sec" : itemRows.has(r) ? "itm" : r >= footerFrom ? "foot" : "";
                    return (
                      <tr key={r} className={cls}>
                        <td className="rh">{r}</td>
                        {letters.map((l) => {
                          const ref = l + r;
                          const c = data.cells[ref];
                          const isInput = (itemRows.has(r) && inputCols.has(l) && !c?.f) || fieldCells.has(ref);
                          const v = c?.v;
                          const text = v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : String(v);
                          return (
                            <td key={l} className={`${isInput ? "inp" : ""} ${c?.f ? "fx" : ""}`} title={c?.f ? `=${c.f}` : text}>
                              {c?.f && !text ? "ƒ" : text}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {creating && <NewClientProject template={t} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewClientProject({ template, onClose }: { template: ClientTemplate; onClose: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Novo orçamento"
      subtitle={`Modelo ${template.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn primary"
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const p = await api.createProject({ kind: "client", templateId: template.id, name: name.trim(), client: template.client });
                go(`/c/${p.id}`);
              } catch (e) {
                toast((e as Error).message, "bad");
                setBusy(false);
              }
            }}
          >
            Criar
          </button>
        </>
      }
    >
      <div className="field">
        <label>Nome do orçamento</label>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Ex.: ${template.client || "Cliente"} — Loja Centro`} />
      </div>
    </Modal>
  );
}

function colNum(col: string) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colLetter(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
