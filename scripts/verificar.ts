// Verificação automática das planilhas.
//
//   npm run verificar                      → usa os arquivos listados em exemplos.local.json
//   npm run verificar -- arquivo1.xlsm ... → verifica os arquivos informados
//
// Planilha no modelo da empresa: lê, recalcula, grava numa cópia temporária, relê e
// confere que a estrutura e os totais não mudaram (ida e volta).
// Planilha de cliente: detecta a estrutura, preenche preços de teste em algumas linhas,
// calcula os totais com as fórmulas do cliente, grava e confere as células gravadas.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workbook } from "../server/xlsx/workbook.ts";
import { isTopsiteWorkbook, parseTopsite, writeTopsite } from "../server/topsite.ts";
import { detectTemplate, writeClient } from "../server/clientTemplate.ts";
import { computeBudget } from "../shared/calc.ts";
import { clientTotal } from "../shared/summary.ts";
import { money } from "../shared/format.ts";
import type { ClientProject, ClientTemplate, TopsiteProject } from "../shared/types.ts";

function filesToCheck(): string[] {
  const args = process.argv.slice(2);
  if (args.length) return args;
  const manifest = path.resolve("exemplos.local.json");
  if (!fs.existsSync(manifest)) {
    console.log("Informe as planilhas: npm run verificar -- caminho/planilha.xlsm");
    process.exit(1);
  }
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  return [m.modelo, ...(m.projetos ?? []).map((p: { arquivo: string }) => p.arquivo), ...(m.modelosClientes ?? []).map((t: { arquivo: string }) => t.arquivo)].filter(Boolean);
}

const strip = (n: unknown): unknown => {
  const { id: _id, children, ...rest } = n as { id: string; children?: unknown[] };
  return { ...rest, children: children?.map(strip) };
};

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
};

for (const file of filesToCheck()) {
  console.log(`\n${path.basename(file)}`);
  if (!fs.existsSync(file)) {
    ok(false, "arquivo não encontrado");
    continue;
  }
  const wb = await Workbook.load(fs.readFileSync(file));
  const tmp = path.join(os.tmpdir(), `excelencia-verificacao-${Date.now()}${path.extname(file)}`);

  if (isTopsiteWorkbook(wb)) {
    const parsed = await parseTopsite(wb);
    const p = { ...parsed.project, id: "x", createdAt: "", updatedAt: "" } as TopsiteProject;
    const calc = computeBudget(p);
    console.log(`  modelo da empresa · ${calc.leafCount} itens · custo ${money(calc.cost)} · total ${money(calc.total)}`);
    (p.warnings ?? []).forEach((w) => console.log(`  ! ${w}`));
    await writeTopsite(wb, p, parsed.lastUsedRow);
    fs.writeFileSync(tmp, await wb.save());
    const again = await parseTopsite(await Workbook.load(fs.readFileSync(tmp)));
    const p2 = { ...again.project, id: "x", createdAt: "", updatedAt: "" } as TopsiteProject;
    ok(JSON.stringify(p.roots.map(strip)) === JSON.stringify(p2.roots.map(strip)), "estrutura idêntica após gravar e reler");
    ok(Math.abs(computeBudget(p2).total - calc.total) < 0.005, "total idêntico após gravar e reler");
  } else {
    const det = await detectTemplate(wb);
    const t = { ...det.template, id: "t", name: "teste", client: "", fileName: path.basename(file), createdAt: "", updatedAt: "" } as ClientTemplate;
    const items = t.sections.flatMap((s) => s.items);
    console.log(`  modelo de cliente · aba "${t.sheet}" · ${t.sections.length} seções · ${items.length} itens · ${t.fields.length + t.params.length} campos`);
    ok(items.length > 0, "itens reconhecidos");
    const { unitPrice, qty } = t.columns;
    const values: Record<string, number> = {};
    items
      .filter((it) => it.editable.unitPrice)
      .slice(0, 3)
      .forEach((it, i) => {
        values[`${unitPrice}${it.row}`] = 100 * (i + 1);
        if (it.editable.qty && !(typeof it.defaults.qty === "number" && it.defaults.qty > 0)) values[`${qty}${it.row}`] = 1;
      });
    const project = { id: "p", kind: "client", templateId: "t", info: { name: "teste" }, values, currency: { display: "BRL", foreign: "USD", rate: 1, mode: "manual" }, createdAt: "", updatedAt: "" } as ClientProject;
    const total = clientTotal(t, det.cells, project);
    console.log(`  valor final calculado com as fórmulas do cliente: ${money(total)}`);
    ok(total > 0, "totais respondem aos preços preenchidos");
    await writeClient(wb, t, project);
    fs.writeFileSync(tmp, await wb.save());
    const sheet = await (await Workbook.load(fs.readFileSync(tmp))).readSheet(t.sheet);
    ok(Object.entries(values).every(([ref, v]) => sheet.cells.get(ref)?.v === v), "valores gravados nas células de entrada");
  }
  fs.rmSync(tmp, { force: true });
}

console.log(failures ? `\n${failures} verificação(ões) falharam.` : "\nTudo certo.");
process.exit(failures ? 1 : 0);
