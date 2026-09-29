import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, MoreHorizontal, PanelRightOpen, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { Menu, Segmented } from "../components/ui";
import { NumberCell, TextAreaCell, TextCell } from "../components/cells";
import type { BudgetCalc } from "../../shared/calc";
import { CATALOG, UNITS, matchDiscipline, suggestItems } from "../../shared/catalog";
import { money, num, pct } from "../../shared/format";
import type { BudgetNode, CurrencyCode, TopsiteProject } from "../../shared/types";

export interface SheetOps {
  addDiscipline: (name: string) => void;
  addGroup: (disciplineId: string, name: string) => void;
  addItem: (groupId: string, partial?: Partial<BudgetNode>) => void;
  rename: (id: string, name: string) => void;
  patch: (id: string, patch: Partial<BudgetNode>) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  duplicate: (id: string) => void;
  select: (id: string | null, open?: boolean) => void;
}

export function StructureNav({ project, calc, onJump, active }: { project: TopsiteProject; calc: BudgetCalc; onJump: (id: string) => void; active: string | null }) {
  const level2 = project.roots.flatMap((r) => r.children ?? []);
  const max = Math.max(...level2.map((d) => calc.byId.get(d.id)?.cost ?? 0), 1);
  return (
    <aside className="structure">
      <div className="structure-head">
        <span className="eyebrow">Estrutura</span>
        <span className="xs muted">{level2.length} disciplinas</span>
      </div>
      <div className="structure-list">
        {level2.map((d) => {
          const c = calc.byId.get(d.id)!;
          return (
            <Fragment key={d.id}>
              <button className={`snode ${active === d.id ? "on" : ""}`} onClick={() => onJump(d.id)}>
                <span className="nm" title={d.description}>{d.description}</span>
                <span className="vl">{calc.cost ? pct(c.cost / calc.cost, 0) : "—"}</span>
                <span className="bar"><i style={{ width: `${(c.cost / max) * 100}%` }} /></span>
              </button>
              {active === d.id &&
                (d.children ?? []).map((g) => (
                  <button key={g.id} className="snode sub" onClick={() => onJump(g.id)}>
                    <span className="nm">{g.description}</span>
                    <span className="vl">{money(calc.byId.get(g.id)?.cost ?? 0, "BRL", { compact: true })}</span>
                  </button>
                ))}
            </Fragment>
          );
        })}
        {!level2.length && <div className="small muted" style={{ padding: 10 }}>Adicione a primeira disciplina na planilha ao lado.</div>}
      </div>
    </aside>
  );
}

export function BudgetSheet({
  project,
  calc,
  ops,
  selected,
  rateOf,
  onAskAI,
}: {
  project: TopsiteProject;
  calc: BudgetCalc;
  ops: SheetOps;
  selected: string | null;
  rateOf: (c: CurrencyCode) => number;
  onAskAI: (prompt: string) => void;
}) {
  const [mode, setMode] = useState<"cost" | "sale">("cost");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();

  const visibleLeaf = (n: BudgetNode) =>
    !term || `${n.description} ${n.supplier ?? ""} ${n.comments ?? ""} ${(n.specs ?? []).map((s) => s.value).join(" ")}`.toLowerCase().includes(term);
  const hasVisible = useMemo(() => {
    const memo = new Map<string, boolean>();
    const rec = (n: BudgetNode): boolean => {
      const v = n.level === 4 ? visibleLeaf(n) : (n.children ?? []).some(rec) || (!!term && n.description.toLowerCase().includes(term));
      memo.set(n.id, v);
      return v;
    };
    project.roots.forEach(rec);
    return memo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.roots, term]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cols = mode === "cost" ? 9 : 8;
  const presentDisciplines = new Set(project.roots.flatMap((r) => r.children ?? []).map((d) => matchDiscipline(d.description)?.name));

  const rows: ReactNode[] = [];
  const renderNode = (n: BudgetNode, discipline: BudgetNode | null) => {
    if (!hasVisible.get(n.id) && term) return;
    const c = calc.byId.get(n.id)!;
    const isCollapsed = collapsed.has(n.id) && !term;
    const total = mode === "cost" ? c.cost : c.sale;
    const grand = mode === "cost" ? calc.cost : calc.sale;
    if (n.level < 4) {
      rows.push(
        <tr key={n.id} id={`row-${n.id}`} className={`lvl${n.level}`}>
          <td className="code">{c.code}</td>
          <td colSpan={cols - 3}>
            <div className="grouptitle">
              <button className="btn ghost xs icon" onClick={() => toggle(n.id)} aria-label={isCollapsed ? "Expandir" : "Recolher"}>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <TextCell value={n.description} onCommit={(v) => ops.rename(n.id, v)} className="desc" ariaLabel="Nome" />
            </div>
          </td>
          <td className="r tot">
            {money(total)}
            {n.level > 1 && grand > 0 && <span className="share">{pct(total / grand, 1)}</span>}
          </td>
          <td className="r" style={{ width: 64, paddingRight: 10 }}>
            <div className="rowactions">
              {n.level === 1 && <DisciplinePicker onPick={ops.addDiscipline} present={presentDisciplines} compact />}
              {n.level === 2 && <GroupPicker discipline={n} onPick={(name) => ops.addGroup(n.id, name)} compact />}
              {n.level === 3 && (
                <button className="btn ghost xs icon" title="Adicionar item" onClick={() => ops.addItem(n.id)}>
                  <Plus size={14} />
                </button>
              )}
              <NodeMenu n={n} ops={ops} />
            </div>
          </td>
        </tr>,
      );
      if (!isCollapsed) {
        (n.children ?? []).forEach((ch) => renderNode(ch, n.level === 2 ? n : discipline));
        if (n.level === 3 && !term) {
          rows.push(
            <tr key={n.id + "-add"} className="add">
              <td />
              <td colSpan={cols - 1}>
                <ItemAdder group={n} discipline={discipline} onAdd={(p) => ops.addItem(n.id, p)} />
              </td>
            </tr>,
          );
        }
        if (n.level === 2 && !term && !(n.children ?? []).length) {
          rows.push(
            <tr key={n.id + "-addg"} className="add">
              <td />
              <td colSpan={cols - 1}>
                <GroupPicker discipline={n} onPick={(name) => ops.addGroup(n.id, name)} />
              </td>
            </tr>,
          );
        }
      }
      return;
    }
    // ---- item (nível 4) ----
    const sel = selected === n.id;
    const specsText = (n.specs ?? []).filter((s) => s.value.trim());
    rows.push(
      <tr key={n.id} id={`row-${n.id}`} className={`item ${sel ? "sel" : ""}`} onFocusCapture={() => !sel && ops.select(n.id)}>
        <td className="code" onDoubleClick={() => ops.select(n.id, true)} style={{ cursor: "pointer" }} title="Duplo clique: detalhes">
          {c.code}
        </td>
        <td className="desc-cell">
          <TextAreaCell value={n.description} onCommit={(v) => ops.patch(n.id, { description: v })} className="desc" nav="desc" ariaLabel="Descrição" placeholder="Descrição do item" autoFocus={n.description === "" && sel} />
          {(specsText.length > 0 || n.comments || n.supplier) && (
            <div className="specline" onClick={() => ops.select(n.id, true)} style={{ cursor: "pointer" }}>
              {n.supplier && <span className="chip" title="Fornecedor">{n.supplier}</span>}
              {specsText.slice(0, 4).map((s, i) => (
                <span key={i} className="chip">
                  {s.key}: {s.value}
                </span>
              ))}
              {specsText.length > 4 && <span className="chip">+{specsText.length - 4}</span>}
              {n.comments && <span className="chip" title={n.comments}>{n.comments.length > 42 ? n.comments.slice(0, 40) + "…" : n.comments}</span>}
            </div>
          )}
        </td>
        <td style={{ width: 64 }}>
          <TextCell value={n.unit} onCommit={(v) => ops.patch(n.id, { unit: v })} list="units" nav="unit" ariaLabel="Unidade" placeholder="un" />
        </td>
        <td style={{ width: 96 }}>
          <NumberCell value={n.qty} expr={n.qtyExpr} nav="qty" ariaLabel="Quantidade" placeholder="0" onCommit={(r) => ops.patch(n.id, { qty: r.value, qtyExpr: r.expr })} />
        </td>
        {mode === "cost" ? (
          <>
            <td style={{ width: 106 }}>
              <NumberCell
                value={n.material}
                expr={n.materialExpr}
                nav="mat"
                ariaLabel="Material unitário"
                placeholder="—"
                rateOf={rateOf}
                badge={n.foreign?.material ? n.foreign.currency : undefined}
                onCommit={(r) =>
                  ops.patch(n.id, {
                    material: r.value,
                    materialExpr: r.expr,
                    foreign: r.foreign ? { ...(n.foreign?.currency === r.foreign.currency ? n.foreign : {}), currency: r.foreign.currency, rate: r.foreign.rate, material: r.foreign.amount, at: new Date().toISOString() } : n.foreign ? { ...n.foreign, material: null } : undefined,
                  })
                }
              />
            </td>
            <td style={{ width: 106 }}>
              <NumberCell
                value={n.labor}
                expr={n.laborExpr}
                nav="lab"
                ariaLabel="Mão de obra unitária"
                placeholder="—"
                rateOf={rateOf}
                badge={n.foreign?.labor ? n.foreign.currency : undefined}
                onCommit={(r) =>
                  ops.patch(n.id, {
                    labor: r.value,
                    laborExpr: r.expr,
                    foreign: r.foreign ? { ...(n.foreign?.currency === r.foreign.currency ? n.foreign : {}), currency: r.foreign.currency, rate: r.foreign.rate, labor: r.foreign.amount, at: new Date().toISOString() } : n.foreign ? { ...n.foreign, labor: null } : undefined,
                  })
                }
              />
            </td>
            <td className="r num muted" style={{ width: 96 }}>{c.unitCost ? num(c.unitCost) : ""}</td>
          </>
        ) : (
          <>
            <td style={{ width: 90 }}>
              <NumberCell
                value={n.markup ? n.markup * 100 : null}
                nav="mk"
                ariaLabel="Índice individual (%)"
                placeholder="0"
                decimals={2}
                onCommit={(r) => ops.patch(n.id, { markup: r.value ? r.value / 100 : undefined })}
              />
            </td>
            <td className="r num muted" style={{ width: 120 }}>{c.unitSale ? num(c.unitSale) : ""}</td>
          </>
        )}
        <td className="r tot" style={{ width: 124 }}>{total ? money(total) : <span className="muted">—</span>}</td>
        <td className="r" style={{ width: 64, paddingRight: 10 }}>
          <div className="rowactions">
            <button className="btn ghost xs icon" title="Detalhes, especificações e câmbio" onClick={() => ops.select(n.id, true)}>
              <PanelRightOpen size={14} />
            </button>
            <NodeMenu n={n} ops={ops} />
          </div>
        </td>
      </tr>,
    );
  };
  project.roots.forEach((r) => renderNode(r, null));

  return (
    <div className="sheet-wrap">
      <div className="sheet-toolbar">
        <div className="search" style={{ width: 260 }}>
          <Search size={15} />
          <input className="input" style={{ height: 32 }} placeholder="Filtrar itens, fornecedores, cores…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "cost", label: "Custo", title: "Planilha Custo — preços de fornecedores" },
            { value: "sale", label: "Venda", title: "Planilha Venda — custo × BDI × índice individual" },
          ]}
        />
        {mode === "sale" && <span className="small muted">BDI global {pct(project.params.bdi, 1)} · edite o índice individual por item</span>}
        <div className="grow" />
        <button className="btn ghost sm" onClick={() => setCollapsed(new Set())}>Expandir tudo</button>
        <button className="btn ghost sm" onClick={() => setCollapsed(new Set(calc.rows.filter((r) => r.node.level === 2).map((r) => r.node.id)))}>Recolher</button>
        <DisciplinePicker onPick={ops.addDiscipline} present={presentDisciplines} />
      </div>
      <div className="sheet-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Item</th>
              <th>Descrição</th>
              <th>Un.</th>
              <th className="r">Qtd</th>
              {mode === "cost" ? (
                <>
                  <th className="r">Material</th>
                  <th className="r">Mão de obra</th>
                  <th className="r">Unitário</th>
                </>
              ) : (
                <>
                  <th className="r">Índice %</th>
                  <th className="r">Unit. venda</th>
                </>
              )}
              <th className="r">{mode === "cost" ? "Total custo" : "Total venda"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows}
            {!project.roots.flatMap((r) => r.children ?? []).length && (
              <tr>
                <td colSpan={cols}>
                  <div className="empty" style={{ padding: "48px 20px" }}>
                    <div className="h3" style={{ fontSize: 15 }}>Comece pela estrutura</div>
                    <div className="muted" style={{ margin: "6px auto 16px", maxWidth: 460 }}>
                      Adicione as disciplinas da obra (Civil, Elétrica, Piso…). Cada uma vem com grupos e itens típicos sugeridos — ou peça ao assistente para montar a partir de uma cotação.
                    </div>
                    <div className="row wrap" style={{ justifyContent: "center", maxWidth: 640, margin: "0 auto" }}>
                      {CATALOG.slice(0, 8).map((d) => (
                        <button key={d.name} className="chip dashed" onClick={() => ops.addDiscipline(d.name)}>
                          <Plus size={12} /> {d.name}
                        </button>
                      ))}
                    </div>
                    <button className="btn sm" style={{ marginTop: 16 }} onClick={() => onAskAI("Monte a estrutura inicial deste orçamento (disciplinas, grupos e itens típicos, sem preços) para o tipo de obra: ")}>
                      <Sparkles size={14} /> Montar com o assistente
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <datalist id="units">
          {UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

function NodeMenu({ n, ops }: { n: BudgetNode; ops: SheetOps }) {
  return (
    <Menu align="right" trigger={(t) => <button className="btn ghost xs icon" {...t} aria-label="Mais ações"><MoreHorizontal size={14} /></button>}>
      {(close) => (
        <>
          {n.level === 4 && (
            <button className="menu-item" onClick={() => (ops.select(n.id, true), close())}>
              <PanelRightOpen size={15} /> Detalhes e especificações
            </button>
          )}
          <button className="menu-item" onClick={() => (ops.move(n.id, -1), close())}>
            <ArrowUp size={15} /> Mover para cima
          </button>
          <button className="menu-item" onClick={() => (ops.move(n.id, 1), close())}>
            <ArrowDown size={15} /> Mover para baixo
          </button>
          {n.level > 1 && (
            <button className="menu-item" onClick={() => (ops.duplicate(n.id), close())}>
              <Copy size={15} /> Duplicar
            </button>
          )}
          {n.level > 1 && (
            <>
              <div className="menu-sep" />
              <button className="menu-item danger" onClick={() => (ops.remove(n.id), close())}>
                <Trash2 size={15} /> Excluir {n.level === 4 ? "item" : n.level === 3 ? "grupo" : "disciplina"}
              </button>
            </>
          )}
        </>
      )}
    </Menu>
  );
}

function DisciplinePicker({ onPick, present, compact }: { onPick: (name: string) => void; present: Set<string | undefined>; compact?: boolean }) {
  const [custom, setCustom] = useState("");
  return (
    <Menu
      align="right"
      width={280}
      trigger={(t) =>
        compact ? (
          <button className="btn ghost xs icon" title="Adicionar disciplina" {...t}>
            <Plus size={14} />
          </button>
        ) : (
          <button className="btn sm" {...t}>
            <Plus size={14} /> Disciplina
          </button>
        )
      }
    >
      {(close) => (
        <>
          <div className="menu-label">Adicionar disciplina</div>
          <div style={{ padding: "2px 6px 6px" }}>
            <input
              className="input"
              style={{ height: 30 }}
              placeholder="Outra disciplina… (Enter)"
              value={custom}
              autoFocus
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  onPick(custom.trim().toUpperCase());
                  setCustom("");
                  close();
                }
              }}
            />
          </div>
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {CATALOG.map((d) => (
              <button key={d.name} className="menu-item" onClick={() => (onPick(d.name), close())}>
                <span className="grow">{d.name}</span>
                {present.has(d.name) && <span className="kbd">já existe</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </Menu>
  );
}

function GroupPicker({ discipline, onPick, compact }: { discipline: BudgetNode; onPick: (name: string) => void; compact?: boolean }) {
  const [custom, setCustom] = useState("");
  const cat = matchDiscipline(discipline.description);
  const existing = new Set((discipline.children ?? []).map((g) => g.description.toLowerCase()));
  return (
    <Menu
      align={compact ? "right" : "left"}
      width={280}
      trigger={(t) =>
        compact ? (
          <button className="btn ghost xs icon" title="Adicionar grupo" {...t}>
            <Plus size={14} />
          </button>
        ) : (
          <button className="btn ghost sm" {...t}>
            <Plus size={14} /> Adicionar grupo
          </button>
        )
      }
    >
      {(close) => (
        <>
          <div className="menu-label">Novo grupo em {discipline.description}</div>
          <div style={{ padding: "2px 6px 6px" }}>
            <input
              className="input"
              style={{ height: 30 }}
              placeholder="Nome do grupo (Enter)"
              value={custom}
              autoFocus
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  onPick(custom.trim());
                  setCustom("");
                  close();
                }
              }}
            />
          </div>
          {cat?.groups
            .filter((g) => !existing.has(g.name.toLowerCase()))
            .map((g) => (
              <button key={g.name} className="menu-item" onClick={() => (onPick(g.name), close())}>
                <span className="grow">{g.name}</span>
                <span className="kbd">{g.items.length} itens</span>
              </button>
            ))}
        </>
      )}
    </Menu>
  );
}

function ItemAdder({ group, discipline, onAdd }: { group: BudgetNode; discipline: BudgetNode | null; onAdd: (p?: Partial<BudgetNode>) => void }) {
  const suggestions = suggestItems(discipline?.description ?? "", group.description).filter(
    (s) => !(group.children ?? []).some((c) => c.description.toLowerCase() === s.description.toLowerCase()),
  );
  return (
    <div className="row" style={{ gap: 6, padding: "2px 0" }}>
      <button className="btn ghost xs" onClick={() => onAdd()}>
        <Plus size={13} /> Item
      </button>
      {suggestions.slice(0, 4).map((s) => (
        <button key={s.description} className="chip dashed" style={{ height: 22, fontSize: 11.5 }} onClick={() => onAdd({ description: s.description, unit: s.unit, specs: s.specs?.map((k) => ({ key: k, value: "" })) })}>
          <Plus size={11} /> {s.description}
        </button>
      ))}
    </div>
  );
}
