// Tipos compartilhados entre servidor e interface.

export type CurrencyCode =
  | "BRL"
  | "USD"
  | "EUR"
  | "ARS"
  | "CLP"
  | "MXN"
  | "COP"
  | "UYU"
  | "PYG"
  | "PEN";

export type Level = 1 | 2 | 3 | 4;

export interface Spec {
  key: string;
  value: string;
}

/** Valor digitado em moeda estrangeira e convertido para BRL. */
export interface ForeignPrice {
  currency: CurrencyCode;
  rate: number; // BRL por 1 unidade da moeda
  material?: number | null;
  labor?: number | null;
  at: string; // ISO
}

/**
 * Linha da Planilha Custo. Níveis 1–3 agrupam; só o nível 4 recebe valores
 * (mesma regra da coluna L: nível 4 = K × H, demais = soma dos filhos).
 */
export interface BudgetNode {
  id: string;
  level: Level;
  description: string;
  supplier?: string; // coluna E – Fornecedor/observações
  comments?: string; // coluna F – Comentários
  unit?: string; // G
  qty?: number | null; // H
  qtyExpr?: string; // fórmula digitada em H (ex.: 135.4*1.2)
  material?: number | null; // I (unitário)
  materialExpr?: string;
  labor?: number | null; // J (unitário)
  laborExpr?: string;
  markup?: number; // índice individual da Planilha Venda (AK), fração
  specs?: Spec[];
  foreign?: ForeignPrice;
  children?: BudgetNode[];
}

export interface ProjectInfo {
  name: string; // Resumo!E1
  company: string; // Resumo!D4
  client?: string;
  location?: string;
  date?: string; // ISO yyyy-mm-dd → Resumo!E4
  revision: string; // Resumo!G4
  area?: number | null; // m² (somente na ferramenta)
  notes?: string; // Resumo!D168 (OBS.)
}

export interface BudgetParams {
  bdi: number; // Venda!AK1 (Índice Global Venda)
  admin: number; // Resumo!K163
  tax: number; // Resumo!K164
  adminLabel: string; // Resumo!D163
  taxLabel: string; // Resumo!D164
  summaryLevel: number; // Resumo!K3 (nível estrutural do resumo)
}

export interface CurrencySettings {
  display: CurrencyCode; // moeda em que a ferramenta mostra os valores
  foreign: CurrencyCode; // Custo!AS1 – moeda da coluna M
  rate: number; // Custo!AS2 – BRL por 1 unidade de `foreign`
  mode: "live" | "manual";
  rateAt?: string;
}

export interface SyncState {
  excelFile: string;
  lastExcelWrite?: string;
  lastExcelMtime?: number;
  lastError?: string | null;
  lastRow?: number; // última linha usada na Planilha Custo
  baseKey?: string; // versão no navegador: planilha de origem guardada localmente
}

export interface TopsiteProject {
  id: string;
  kind: "topsite";
  info: ProjectInfo;
  params: BudgetParams;
  currency: CurrencySettings;
  roots: BudgetNode[];
  createdAt: string;
  updatedAt: string;
  sync?: SyncState;
  warnings?: string[];
}

// ---------- Modelos de clientes ----------

export type ClientColumnKey =
  | "code"
  | "desc"
  | "qty"
  | "unit"
  | "unitPrice"
  | "total"
  | "applicable"
  | "obs";

export type ClientColumns = Partial<Record<ClientColumnKey, string>>; // letra da coluna

export interface TemplateItem {
  row: number;
  code: string;
  desc: string;
  /** células editáveis (sem fórmula) por campo */
  editable: Partial<Record<Exclude<ClientColumnKey, "code" | "total">, boolean>>;
  defaults: Partial<Record<ClientColumnKey, string | number | null>>;
}

export interface TemplateSection {
  row: number;
  code: string;
  title: string;
  totalCell?: string;
  items: TemplateItem[];
}

export interface TemplateField {
  cell: string;
  label: string;
  kind: "text" | "number" | "date" | "percent";
  defaultValue?: string | number | null;
}

export interface TemplateOutput {
  cell: string;
  label: string;
  kind: "money" | "percent" | "number";
}

export interface ClientTemplate {
  id: string;
  name: string;
  client: string;
  fileName: string;
  sheet: string;
  sheets: string[];
  headerRow: number;
  columns: ClientColumns;
  sections: TemplateSection[];
  fields: TemplateField[]; // cabeçalho (construtora, data, revisão…)
  params: TemplateField[]; // parâmetros do rodapé (taxas, descontos…)
  outputs: TemplateOutput[]; // resultados calculados (total, valor final…)
  staticTotals?: string[]; // células de total sem fórmula (a ferramenta grava qtd × unitário)
  grandTotalCell?: string;
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClientProject {
  id: string;
  kind: "client";
  templateId: string;
  info: { name: string; client?: string; revision?: string };
  values: Record<string, string | number | null>; // referência da célula → valor
  foreign?: Record<string, ForeignPrice>; // célula → preço digitado em moeda estrangeira
  currency: CurrencySettings;
  createdAt: string;
  updatedAt: string;
  sync?: SyncState;
}

export type AnyProject = TopsiteProject | ClientProject;

export interface ProjectSummary {
  id: string;
  kind: "topsite" | "client";
  name: string;
  client?: string;
  company?: string;
  revision?: string;
  total: number; // BRL
  cost?: number;
  sale?: number;
  items: number;
  totalItems?: number;
  display: CurrencyCode;
  rate: number;
  templateName?: string;
  topGroups?: { name: string; value: number }[];
  updatedAt: string;
}

export interface FxRate {
  code: CurrencyCode;
  name: string;
  rate: number; // BRL por 1 unidade
  at: string;
  source: string;
}

// ---------- Assistente de IA ----------

export type Proposal =
  | {
      id: string;
      type: "add_items";
      discipline: string;
      group: string;
      items: ProposedItem[];
      note?: string;
    }
  | { id: string; type: "update_item"; itemId: string; changes: Partial<ProposedItem>; note?: string }
  | { id: string; type: "remove_item"; itemId: string; note?: string }
  | {
      id: string;
      type: "set_params";
      changes: { bdi?: number; admin?: number; tax?: number; display?: CurrencyCode };
      note?: string;
    }
  | {
      id: string;
      type: "fill_client_row";
      row: number;
      changes: { qty?: number; unitPrice?: number; unit?: string; obs?: string; applicable?: string; desc?: string; currency?: CurrencyCode };
      note?: string;
    }
  | { id: string; type: "fill_client_cell"; cell: string; value: string | number; note?: string };

export interface ProposedItem {
  description: string;
  unit?: string;
  qty?: number | null;
  material?: number | null;
  labor?: number | null;
  currency?: CurrencyCode;
  supplier?: string;
  comments?: string;
  specs?: Spec[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}
