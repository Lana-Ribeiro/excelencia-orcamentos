// Assistente de IA (Claude) — ajuda a preencher o orçamento e gera análises.
//
// O assistente nunca altera a planilha diretamente: cada alteração vira uma
// "proposta" que o usuário revisa e aplica na interface.

import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { z } from "zod";
import { Workbook } from "./xlsx/workbook.ts";
import { computeBudget, commentsForExcel, uid } from "../shared/calc.ts";
import { CURRENCY_CODES, money, num, pct } from "../shared/format.ts";
import { SheetEvaluator, type EvalCell } from "../shared/formula.ts";
import type {
  AnyProject,
  BudgetNode,
  ChatTurn,
  ClientProject,
  ClientTemplate,
  CurrencyCode,
  FxRate,
  Proposal,
  ProposedItem,
  TopsiteProject,
} from "../shared/types.ts";

export const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5";
let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export function aiStatus() {
  const hasEnv = !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
  return { configured: hasEnv, model: MODEL };
}

export interface Attachment {
  name: string;
  type: string; // mime
  data: string; // base64
}

// ---------------- SSE ----------------
function sse(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function friendlyError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError)
    return "A chave da API da Anthropic não foi configurada ou é inválida. Configure ANTHROPIC_API_KEY (arquivo .env no computador ou segredos do servidor na nuvem) e reinicie a ferramenta.";
  if (err instanceof Anthropic.PermissionDeniedError) return "A chave da API não tem permissão para usar este modelo.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de uso da API atingido. Aguarde alguns instantes e tente novamente.";
  if (err instanceof Anthropic.BadRequestError) return `A requisição foi recusada pela API: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Sem conexão com a API da Anthropic. Verifique a internet.";
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status}): ${err.message}`;
  const msg = (err as Error)?.message ?? String(err);
  if (/api key|apiKey|authentication|credentials/i.test(msg))
    return "A chave da API da Anthropic não foi configurada. Configure ANTHROPIC_API_KEY (arquivo .env no computador ou segredos do servidor na nuvem) e reinicie a ferramenta.";
  return msg;
}

// ---------------- instruções ----------------
const BASE_SYSTEM = `Você é o Assistente Excelência, orçamentista sênior de uma empresa de engenharia e gerenciamento de obras — retrofit e implantação de lojas de varejo de alto padrão em shoppings, escritórios e espaços corporativos. Você ajuda a equipe a preencher planilhas orçamentárias com precisão e rapidez. A ética da empresa é entregar tudo com excelência.

Como trabalhar:
- Use as ferramentas para PROPOR alterações. O usuário revisa e aplica cada proposta na tela; nunca diga que já alterou a planilha — diga que deixou as propostas para revisão.
- Ao receber cotações de fornecedores (texto, PDF, imagem ou planilha), extraia cada item com quantidade, unidade, preço unitário de material e de mão de obra separados quando possível, nome do fornecedor e premissas ("considerado…", "não considerado…"). Se vier só o preço total, calcule o unitário. Se vier um preço global de material + mão de obra sem separação, coloque tudo em material e registre isso no comentário.
- Nunca invente preços. Se pedirem estimativa, deixe claro que é referência de mercado a validar e registre "Estimativa — validar com fornecedor" no comentário do item.
- Levante as especificações que importam para cada tipo de serviço (elétrica → bitola, cor do fio, tipo de cabo, corrente; piso → referência, cor, paginação, perda; pintura → código da cor, acabamento, marca, demãos; iluminação → temperatura de cor, IRC, potência, dimerização). Registre-as no campo de especificações. Proponha com o que tiver e aponte, em uma frase, o que ainda falta confirmar.
- Preços em moeda estrangeira: informe o valor original e a moeda no campo "moeda"; a ferramenta converte para reais pela cotação do dia.
- Respostas curtas, em português do Brasil, números no padrão brasileiro (R$ 1.234,56). Prefira listas curtas; evite tabelas longas.`;

const TOPSITE_SYSTEM = `${BASE_SYSTEM}

Modelo de planilha da empresa (Planilha Custo → Venda → Resumo):
- Hierarquia: nível 1 (projeto) → nível 2 (disciplina, em MAIÚSCULAS, ex.: ELÉTRICA, PISO) → nível 3 (grupo, ex.: "Instalação de tomadas e pontos") → nível 4 (item com valores). Só o nível 4 recebe valores.
- Custo unitário = material + mão de obra; total = unitário × quantidade.
- Preço de venda = custo × (1 + BDI global) × (1 + índice individual do item). No Resumo, a Administração incide sobre a venda e o Imposto é calculado "por dentro" sobre (venda + administração).
- Reaproveite disciplinas e grupos existentes (mesmo nome) sempre que fizer sentido; crie novos só quando necessário.
- Para alterar ou remover itens use o id entre chaves mostrado no estado do orçamento (ex.: {n1a2b3}).`;

const CLIENT_SYSTEM = `${BASE_SYSTEM}

Modo planilha do cliente: a estrutura (seções e itens) é fixa e pertence ao cliente — não crie nem remova linhas. Você só pode preencher as células de entrada de cada linha (quantidade, unidade, preço unitário, aplicável, observações e a descrição de linhas em branco) com a ferramenta propor_preenchimento_linha, usando o número da linha. Campos do cabeçalho e parâmetros do rodapé usam propor_campo com a referência da célula.`;

// ---------------- ferramentas ----------------
const specsSchema = { type: "array", items: { type: "object", properties: { campo: { type: "string" }, valor: { type: "string" } }, required: ["campo", "valor"] } };
const moedaSchema = { type: "string", enum: CURRENCY_CODES, description: "Moeda dos preços informados (padrão BRL)" };
const itemProps = {
  descricao: { type: "string" },
  unidade: { type: "string", description: "un, vb, m², ml, m, pontos, dia, mês, kg…" },
  quantidade: { type: "number" },
  material_unitario: { type: "number", description: "Custo unitário de material" },
  mao_de_obra_unitaria: { type: "number", description: "Custo unitário de mão de obra" },
  moeda: moedaSchema,
  fornecedor: { type: "string", description: "Fornecedor / observações (coluna E)" },
  comentarios: { type: "string", description: "Premissas e comentários (coluna F)" },
  especificacoes: specsSchema,
};

const TOPSITE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "propor_itens",
    description: "Propõe adicionar itens (nível 4) em uma disciplina e grupo. Disciplina e grupo são criados se não existirem.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        disciplina: { type: "string", description: "Nome da disciplina (nível 2), em MAIÚSCULAS" },
        grupo: { type: "string", description: "Nome do grupo (nível 3)" },
        itens: { type: "array", items: { type: "object", properties: itemProps, required: ["descricao"] } },
        observacao: { type: "string", description: "Resumo curto da proposta para o usuário" },
      },
      required: ["disciplina", "grupo", "itens"],
    },
  },
  {
    name: "propor_alteracao_item",
    description: "Propõe alterar campos de um item existente (use o id mostrado entre chaves).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { item_id: { type: "string" }, ...itemProps, observacao: { type: "string" } },
      required: ["item_id"],
    },
  },
  {
    name: "propor_remocao_item",
    description: "Propõe remover um item existente.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { item_id: { type: "string" }, motivo: { type: "string" } }, required: ["item_id"] },
  },
  {
    name: "propor_parametros",
    description: "Propõe alterar os parâmetros comerciais (percentuais como número, ex.: 15 para 15%) ou a moeda de apresentação.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        bdi_percentual: { type: "number" },
        administracao_percentual: { type: "number" },
        imposto_percentual: { type: "number" },
        moeda_apresentacao: { type: "string", enum: CURRENCY_CODES },
        observacao: { type: "string" },
      },
    },
  },
];

const CLIENT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "propor_preenchimento_linha",
    description: "Propõe preencher as células de entrada de uma linha de item da planilha do cliente.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        linha: { type: "integer" },
        quantidade: { type: "number" },
        unidade: { type: "string" },
        preco_unitario: { type: "number" },
        moeda: moedaSchema,
        aplicavel: { type: "string", description: "sim ou não" },
        observacoes: { type: "string" },
        descricao: { type: "string", description: "Somente para linhas em branco" },
        observacao: { type: "string", description: "Resumo curto para o usuário" },
      },
      required: ["linha"],
    },
  },
  {
    name: "propor_campo",
    description: "Propõe preencher um campo do cabeçalho ou parâmetro do rodapé (referência da célula, ex.: C6). Percentuais como fração (0,1 = 10%).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { celula: { type: "string" }, valor: { type: ["string", "number"] }, observacao: { type: "string" } },
      required: ["celula", "valor"],
    },
  },
];

const zSpecs = z.array(z.object({ campo: z.string(), valor: z.string() })).optional();
const zMoeda = z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]).optional();
const zItem = z.object({
  descricao: z.string().min(1),
  unidade: z.string().optional(),
  quantidade: z.number().optional(),
  material_unitario: z.number().optional(),
  mao_de_obra_unitaria: z.number().optional(),
  moeda: zMoeda,
  fornecedor: z.string().optional(),
  comentarios: z.string().optional(),
  especificacoes: zSpecs,
});
export const zSchemas: Record<string, z.ZodTypeAny> = {
  propor_itens: z.object({ disciplina: z.string().min(1), grupo: z.string().min(1), itens: z.array(zItem).min(1), observacao: z.string().optional() }),
  propor_alteracao_item: zItem.partial().extend({ item_id: z.string().min(1), observacao: z.string().optional() }),
  propor_remocao_item: z.object({ item_id: z.string().min(1), motivo: z.string().optional() }),
  propor_parametros: z.object({
    bdi_percentual: z.number().optional(),
    administracao_percentual: z.number().optional(),
    imposto_percentual: z.number().optional(),
    moeda_apresentacao: zMoeda,
    observacao: z.string().optional(),
  }),
  propor_preenchimento_linha: z.object({
    linha: z.number().int(),
    quantidade: z.number().optional(),
    unidade: z.string().optional(),
    preco_unitario: z.number().optional(),
    moeda: zMoeda,
    aplicavel: z.string().optional(),
    observacoes: z.string().optional(),
    descricao: z.string().optional(),
    observacao: z.string().optional(),
  }),
  propor_campo: z.object({ celula: z.string().regex(/^[A-Z]{1,3}\d+$/), valor: z.union([z.string(), z.number()]), observacao: z.string().optional() }),
};

const toItem = (i: z.infer<typeof zItem> | Partial<z.infer<typeof zItem>>): Partial<ProposedItem> => {
  const out: Partial<ProposedItem> = {};
  if (i.descricao !== undefined) out.description = i.descricao;
  if (i.unidade !== undefined) out.unit = i.unidade;
  if (i.quantidade !== undefined) out.qty = i.quantidade;
  if (i.material_unitario !== undefined) out.material = i.material_unitario;
  if (i.mao_de_obra_unitaria !== undefined) out.labor = i.mao_de_obra_unitaria;
  if (i.moeda !== undefined) out.currency = i.moeda;
  if (i.fornecedor !== undefined) out.supplier = i.fornecedor;
  if (i.comentarios !== undefined) out.comments = i.comentarios;
  if (i.especificacoes !== undefined) out.specs = i.especificacoes.map((s) => ({ key: s.campo, value: s.valor }));
  return out;
};

export function toProposal(name: string, input: any, ctx: { itemIds: Set<string>; rows: Set<number> }): Proposal | string {
  const id = uid("pr");
  switch (name) {
    case "propor_itens":
      return { id, type: "add_items", discipline: input.disciplina.trim(), group: input.grupo.trim(), items: input.itens.map((i: any) => toItem(i) as ProposedItem), note: input.observacao };
    case "propor_alteracao_item": {
      const itemId = String(input.item_id).replace(/[{}]/g, "");
      if (!ctx.itemIds.has(itemId)) return `Item ${input.item_id} não existe. Use um id do estado do orçamento.`;
      const { item_id: _a, observacao, ...rest } = input;
      return { id, type: "update_item", itemId, changes: toItem(rest), note: observacao };
    }
    case "propor_remocao_item": {
      const itemId = String(input.item_id).replace(/[{}]/g, "");
      if (!ctx.itemIds.has(itemId)) return `Item ${input.item_id} não existe.`;
      return { id, type: "remove_item", itemId, note: input.motivo };
    }
    case "propor_parametros": {
      const changes: Extract<Proposal, { type: "set_params" }>["changes"] = {};
      if (input.bdi_percentual !== undefined) changes.bdi = input.bdi_percentual / 100;
      if (input.administracao_percentual !== undefined) changes.admin = input.administracao_percentual / 100;
      if (input.imposto_percentual !== undefined) changes.tax = input.imposto_percentual / 100;
      if (input.moeda_apresentacao) changes.display = input.moeda_apresentacao;
      return { id, type: "set_params", changes, note: input.observacao };
    }
    case "propor_preenchimento_linha": {
      if (!ctx.rows.has(input.linha)) return `A linha ${input.linha} não é uma linha de item editável deste modelo.`;
      return {
        id,
        type: "fill_client_row",
        row: input.linha,
        changes: {
          qty: input.quantidade,
          unit: input.unidade,
          unitPrice: input.preco_unitario,
          currency: input.moeda,
          applicable: input.aplicavel,
          obs: input.observacoes,
          desc: input.descricao,
        },
        note: input.observacao,
      };
    }
    case "propor_campo":
      return { id, type: "fill_client_cell", cell: input.celula, value: input.valor, note: input.observacao };
  }
  return "Ferramenta desconhecida.";
}

// ---------------- estado do orçamento para o modelo ----------------
const fmtN = (v: number | null | undefined) => (typeof v === "number" ? num(v, 2) : "—");

function topsiteSnapshot(p: TopsiteProject, rates: FxRate[]) {
  const calc = computeBudget(p);
  const lines: string[] = [];
  const rec = (nodes: BudgetNode[], depth: number) => {
    for (const n of nodes) {
      const c = calc.byId.get(n.id)!;
      const pad = "  ".repeat(depth);
      if (n.level < 4) {
        const kind = n.level === 1 ? "projeto" : n.level === 2 ? "disciplina" : "grupo";
        lines.push(`${pad}${c.code} ${n.description} (${kind}) — custo R$ ${fmtN(c.cost)}`);
        rec(n.children ?? [], depth + 1);
      } else {
        const specs = commentsForExcel({ specs: n.specs });
        lines.push(
          `${pad}{${n.id}} ${c.code} | ${n.description} | ${n.unit ?? "—"} | qtd ${fmtN(n.qty)} | mat ${fmtN(n.material)} | m.o. ${fmtN(n.labor)} | total R$ ${fmtN(c.cost)}` +
            (n.markup ? ` | índice +${pct(n.markup)}` : "") +
            (n.supplier ? ` | forn.: ${n.supplier}` : "") +
            (n.comments ? ` | coment.: ${n.comments.replace(/\n/g, " / ")}` : "") +
            (specs ? ` | espec.: ${specs}` : ""),
        );
      }
    }
  };
  rec(p.roots, 0);
  const rateLine = rates.map((r) => `${r.code} ${num(r.rate, r.rate < 1 ? 5 : 4)}`).join(" · ");
  return `<orcamento>
Projeto: ${p.info.name} · Cliente: ${p.info.client ?? "—"} · Empresa: ${p.info.company} · Revisão: ${p.info.revision}${p.info.area ? ` · Área: ${num(p.info.area)} m²` : ""}
Moeda de apresentação: ${p.currency.display}${p.currency.display !== "BRL" ? ` (1 ${p.currency.display} = R$ ${num(p.currency.rate, 4)})` : ""}
Parâmetros: BDI ${pct(p.params.bdi)} · ${p.params.adminLabel} ${pct(p.params.admin)} · ${p.params.taxLabel} ${pct(p.params.tax, 2)}
Totais: custo ${money(calc.cost)} · venda ${money(calc.sale)} · administração ${money(calc.admin)} · imposto ${money(calc.tax)} · total da proposta ${money(calc.total)}
Estrutura (itens nível 4: {id} código | descrição | unidade | quantidade | material unit. | mão de obra unit. | total de custo):
${lines.join("\n") || "(vazio)"}
</orcamento>
Cotações do dia (R$ por unidade): ${rateLine || "indisponíveis"}`;
}

function clientSnapshot(p: ClientProject, t: ClientTemplate, cells: Record<string, EvalCell>, rates: FxRate[]) {
  const val = (ref: string) => (ref in p.values ? p.values[ref] : cells[ref]?.v ?? null);
  const ev = new SheetEvaluator(cells, p.values as Record<string, string | number | null>);
  const c = t.columns;
  const lines: string[] = [];
  for (const s of t.sections) {
    lines.push(`Seção ${s.code} ${s.title}${s.totalCell ? ` — subtotal ${money(ev.numeric(s.totalCell) ?? 0)}` : ""}`);
    for (const it of s.items) {
      const get = (col?: string) => (col ? val(`${col}${it.row}`) : null);
      const editable = Object.entries(it.editable)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(",");
      lines.push(
        `  linha ${it.row} | ${it.code} | ${it.desc || (get(c.desc) as string) || "(linha em branco)"} | qtd ${get(c.qty) ?? "—"} | un ${get(c.unit) ?? "—"} | unit ${get(c.unitPrice) ?? "—"} | aplicável ${get(c.applicable) ?? "—"} | obs ${get(c.obs) ?? "—"} [editáveis: ${editable}]`,
      );
    }
  }
  const fields = [...t.fields, ...t.params].map((f) => `${f.cell} ${f.label} = ${val(f.cell) ?? "(vazio)"}`).join("\n");
  const outs = t.outputs.map((o) => `${o.cell} ${o.label} = ${ev.numeric(o.cell) ?? "—"}`).join("\n");
  const rateLine = rates.map((r) => `${r.code} ${num(r.rate, r.rate < 1 ? 5 : 4)}`).join(" · ");
  return `<planilha_cliente modelo="${t.name}" cliente="${t.client}">
Orçamento: ${p.info.name}
${lines.join("\n")}
Campos e parâmetros:
${fields}
Resultados calculados:
${outs}
</planilha_cliente>
Cotações do dia (R$ por unidade): ${rateLine || "indisponíveis"}`;
}

async function attachmentBlocks(atts: Attachment[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of atts) {
    if (a.type === "application/pdf") {
      blocks.push({ type: "document", title: a.name, source: { type: "base64", media_type: "application/pdf", data: a.data } });
    } else if (/^image\/(png|jpeg|gif|webp)$/.test(a.type)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.type as "image/png", data: a.data } });
    } else if (/\.(xlsx|xlsm)$/i.test(a.name)) {
      const wb = await Workbook.load(Buffer.from(a.data, "base64"));
      let text = "";
      for (const sheet of wb.sheetNames.slice(0, 3)) {
        const sd = await wb.readSheet(sheet, { rows: [1, 400] });
        const rows = new Map<number, string[]>();
        for (const [ref, cell] of sd.cells) {
          if (cell.v === null || cell.v === "") continue;
          const r = +ref.replace(/^[A-Z]+/, "");
          if (!rows.has(r)) rows.set(r, []);
          rows.get(r)!.push(`${ref.replace(/\d+$/, "")}: ${cell.v}`);
        }
        text += `\n## Aba ${sheet}\n` + [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `${r} | ${cs.join(" | ")}`).join("\n");
      }
      blocks.push({ type: "text", text: `Planilha anexada (${a.name}):${text.slice(0, 60000)}` });
    } else {
      const text = Buffer.from(a.data, "base64").toString("utf8");
      blocks.push({ type: "text", text: `Arquivo anexado (${a.name}):\n${text.slice(0, 60000)}` });
    }
  }
  return blocks;
}

// ---------------- chat ----------------
export async function streamChat(
  res: Response,
  args: {
    project: AnyProject;
    template?: { template: ClientTemplate; cells: Record<string, EvalCell> };
    history: ChatTurn[];
    message: string;
    attachments: Attachment[];
    rates: FxRate[];
  },
) {
  const send = sse(res);
  let closed = false;
  res.on("close", () => (closed = true));
  const isClient = args.project.kind === "client";
  const system = isClient ? CLIENT_SYSTEM : TOPSITE_SYSTEM;
  const tools = isClient ? CLIENT_TOOLS : TOPSITE_TOOLS;

  const snapshot = isClient
    ? clientSnapshot(args.project as ClientProject, args.template!.template, args.template!.cells, args.rates)
    : topsiteSnapshot(args.project as TopsiteProject, args.rates);

  const ctx = {
    itemIds: new Set<string>(),
    rows: new Set<number>(),
  };
  if (args.project.kind === "topsite") {
    const rec = (ns: BudgetNode[]) => ns.forEach((n) => (ctx.itemIds.add(n.id), rec(n.children ?? [])));
    rec(args.project.roots);
  } else args.template!.template.sections.forEach((s) => s.items.forEach((it) => ctx.rows.add(it.row)));

  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const turn of args.history.slice(-16)) {
    if (!turn.text.trim()) continue;
    messages.push({ role: turn.role, content: turn.text });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(await attachmentBlocks(args.attachments)),
    { type: "text", text: `${snapshot}\n\n${args.message}` },
  ];
  messages.push({ role: "user", content: userContent });

  let proposals = 0;
  let jsonRetries = 0;
  try {
    for (let iteration = 0; iteration < 8 && !closed; iteration++) {
      const stream = getClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      stream.on("text", (delta) => send("text", { delta }));
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // Só o JSON de ferramenta ilegível (AnthropicError que não é erro de API) é repetido;
        // erros de API, credencial ausente etc. sobem para a mensagem de erro amigável.
        const toolJsonError = err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError);
        if (!toolJsonError || jsonRetries++ >= 2) throw err;
        continue;
      }
      if (message.stop_reason === "refusal") {
        send("text", { delta: "\n\nNão posso ajudar com esse pedido." });
        break;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      if (!toolUses.length) break;
      if (message.stop_reason === "max_tokens") {
        send("text", { delta: "\n\n(A resposta ficou longa demais; envie o pedido em partes menores.)" });
        break;
      }
      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const schema = zSchemas[tu.name];
        const parsed = schema?.safeParse(tu.input);
        if (!schema || !parsed?.success) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: `Entrada inválida: ${parsed?.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? "ferramenta desconhecida"}`,
          });
          continue;
        }
        const proposal = toProposal(tu.name, parsed.data, ctx);
        if (typeof proposal === "string") {
          results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: proposal });
          continue;
        }
        proposals++;
        send("proposal", proposal);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: `Proposta registrada (#${proposals}). O usuário vai revisar e aplicar.` });
      }
      messages.push({ role: "user", content: results });
    }
    send("done", { proposals });
  } catch (err) {
    send("error", { message: friendlyError(err) });
  }
  res.end();
}

// ---------------- análise (insights) ----------------
export async function streamInsights(res: Response, args: { project: TopsiteProject; rates: FxRate[]; metrics: string }) {
  const send = sse(res);
  const prompt = `${topsiteSnapshot(args.project, args.rates)}

Indicadores calculados pela ferramenta:
${args.metrics}

Faça uma análise executiva deste orçamento para a equipe interna (não para o cliente). Estruture em Markdown com estes títulos (###):
### Leitura geral — 2 ou 3 frases sobre porte, concentração do investimento e custo por m² se houver área.
### Onde está o dinheiro — as disciplinas e itens que mais pesam e se isso é coerente para este tipo de obra.
### Pontos de atenção — itens sem preço, unidades ou quantidades suspeitas, premissas ausentes, riscos de escopo (o que costuma faltar neste tipo de obra e não aparece).
### Oportunidades — onde negociar, cotar de novo ou rever especificação.
### Perguntas a fazer — para fornecedores e para o cliente.
Seja específico (cite itens e valores), objetivo e use no máximo 380 palavras.`;
  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: TOPSITE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    stream.on("text", (delta) => send("text", { delta }));
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") send("text", { delta: "\n\nNão foi possível gerar a análise." });
    send("done", {});
  } catch (err) {
    send("error", { message: friendlyError(err) });
  }
  res.end();
}
