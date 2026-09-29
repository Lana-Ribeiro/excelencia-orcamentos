// Avaliador de fórmulas do Excel (subconjunto) para pré-visualizar os totais das
// planilhas de clientes dentro da ferramenta. O arquivo final continua sendo
// calculado pelo próprio Excel; aqui só mostramos o resultado ao vivo.

export type Prim = number | string | boolean | null;
export interface XlError {
  error: string;
}
type Val = Prim | XlError | RangeVal;
interface RangeVal {
  range: { ref: string; value: Prim | XlError; isSubtotal: boolean }[];
}

export interface EvalCell {
  v: Prim;
  f?: string;
}

const isErr = (v: unknown): v is XlError => typeof v === "object" && v !== null && "error" in v;
const isRange = (v: unknown): v is RangeVal => typeof v === "object" && v !== null && "range" in v;

function colToNum(col: string) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function numToCol(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------- tokenização ----------
type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ref"; v: string }
  | { t: "range"; a: string; b: string }
  | { t: "fn"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src.replace(/^=/, "");
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1,
        str = "";
      while (j < s.length) {
        if (s[j] === '"' && s[j + 1] === '"') {
          str += '"';
          j += 2;
        } else if (s[j] === '"') break;
        else str += s[j++];
      }
      out.push({ t: "str", v: str });
      i = j + 1;
      continue;
    }
    if (ch === "(") {
      out.push({ t: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ t: ")" });
      i++;
      continue;
    }
    if (ch === "," || ch === ";") {
      out.push({ t: "," });
      i++;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "'" ) throw new Error("referência a outra aba não suportada");
    const rest = s.slice(i);
    const range = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)/.exec(rest);
    if (range) {
      out.push({ t: "range", a: range[1] + range[2], b: range[3] + range[4] });
      i += range[0].length;
      continue;
    }
    const fn = /^([A-Z][A-Z0-9.]*)\s*\(/i.exec(rest);
    if (fn) {
      out.push({ t: "fn", v: fn[1].toUpperCase() });
      i += fn[1].length;
      continue;
    }
    const ref = /^\$?([A-Z]{1,3})\$?(\d+)(?![A-Z0-9(])/.exec(rest);
    if (ref) {
      out.push({ t: "ref", v: ref[1] + ref[2] });
      i += ref[0].length;
      continue;
    }
    const numM = /^(\d+\.?\d*|\.\d+)(E[+-]?\d+)?/i.exec(rest);
    if (numM) {
      out.push({ t: "num", v: parseFloat(numM[0]) });
      i += numM[0].length;
      continue;
    }
    const bool = /^(TRUE|FALSE|VERDADEIRO|FALSO)\b/i.exec(rest);
    if (bool) {
      out.push({ t: "bool", v: /^(TRUE|VERDADEIRO)$/i.test(bool[1]) });
      i += bool[0].length;
      continue;
    }
    if (rest.includes("!")) throw new Error("referência a outra aba não suportada");
    throw new Error("token inválido: " + rest.slice(0, 10));
  }
  return out;
}

// ---------- AST ----------
type Node =
  | { k: "lit"; v: Prim }
  | { k: "ref"; ref: string }
  | { k: "range"; a: string; b: string }
  | { k: "fn"; name: string; args: Node[] }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "neg"; e: Node }
  | { k: "pct"; e: Node };

function parse(tokens: Tok[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (...ops: string[]) => {
    const t = peek();
    return t && t.t === "op" && ops.includes(t.v);
  };
  const cmp = (): Node => {
    let l = concat();
    while (isOp("=", "<>", "<", ">", "<=", ">=")) {
      const op = (tokens[p++] as { v: string }).v;
      l = { k: "bin", op, l, r: concat() };
    }
    return l;
  };
  const concat = (): Node => {
    let l = add();
    while (isOp("&")) {
      p++;
      l = { k: "bin", op: "&", l, r: add() };
    }
    return l;
  };
  const add = (): Node => {
    let l = mul();
    while (isOp("+", "-")) {
      const op = (tokens[p++] as { v: string }).v;
      l = { k: "bin", op, l, r: mul() };
    }
    return l;
  };
  const mul = (): Node => {
    let l = pow();
    while (isOp("*", "/")) {
      const op = (tokens[p++] as { v: string }).v;
      l = { k: "bin", op, l, r: pow() };
    }
    return l;
  };
  const pow = (): Node => {
    let l = unary();
    while (isOp("^")) {
      p++;
      l = { k: "bin", op: "^", l, r: unary() };
    }
    return l;
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return { k: "neg", e: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    let e = primary();
    while (isOp("%")) {
      p++;
      e = { k: "pct", e };
    }
    return e;
  };
  const primary = (): Node => {
    const t = tokens[p++];
    if (!t) throw new Error("fim inesperado");
    switch (t.t) {
      case "num":
        return { k: "lit", v: t.v };
      case "str":
        return { k: "lit", v: t.v };
      case "bool":
        return { k: "lit", v: t.v };
      case "ref":
        return { k: "ref", ref: t.v };
      case "range":
        return { k: "range", a: t.a, b: t.b };
      case "fn": {
        if (tokens[p++]?.t !== "(") throw new Error("(");
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            if (peek()?.t === "," ) {
              args.push({ k: "lit", v: null });
              p++;
              continue;
            }
            args.push(cmp());
            if (peek()?.t === ",") {
              p++;
              continue;
            }
            break;
          }
        }
        if (tokens[p++]?.t !== ")") throw new Error(")");
        return { k: "fn", name: t.v, args };
      }
      case "(": {
        const e = cmp();
        if (tokens[p++]?.t !== ")") throw new Error(")");
        return e;
      }
      default:
        throw new Error("sintaxe");
    }
  };
  const tree = cmp();
  if (p !== tokens.length) throw new Error("sobra de tokens");
  return tree;
}

// ---------- avaliação ----------
const toNum = (v: Prim | XlError): number | XlError => {
  if (isErr(v)) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : { error: "#VALUE!" };
};

export class SheetEvaluator {
  private memo = new Map<string, Prim | XlError>();
  private visiting = new Set<string>();
  private ast = new Map<string, Node | null>();

  constructor(
    private cells: Record<string, EvalCell>,
    private overrides: Record<string, Prim> = {},
  ) {}

  /** Valor de uma célula (avaliando a fórmula se houver). Null quando não for possível calcular. */
  value(ref: string): Prim {
    const v = this.get(ref);
    return isErr(v) ? null : v;
  }

  numeric(ref: string): number | null {
    const v = this.get(ref);
    if (isErr(v)) return null;
    const n = toNum(v);
    return isErr(n) ? null : n;
  }

  private get(ref: string): Prim | XlError {
    if (ref in this.overrides) {
      const o = this.overrides[ref];
      return o === undefined ? null : o;
    }
    if (this.memo.has(ref)) return this.memo.get(ref)!;
    const cell = this.cells[ref];
    if (!cell) return null;
    if (!cell.f) return cell.v;
    if (this.visiting.has(ref)) return { error: "#REF!" };
    this.visiting.add(ref);
    let result: Prim | XlError;
    try {
      let tree = this.ast.get(ref);
      if (tree === undefined) {
        try {
          tree = parse(tokenize(cell.f));
        } catch {
          tree = null;
        }
        this.ast.set(ref, tree);
      }
      if (!tree) result = cell.v ?? { error: "#N/A" };
      else {
        const r = this.evalNode(tree);
        result = isRange(r) ? (r.range[0]?.value ?? null) : r;
      }
    } catch {
      result = cell.v ?? { error: "#N/A" };
    }
    this.visiting.delete(ref);
    this.memo.set(ref, result);
    return result;
  }

  private rangeOf(a: string, b: string): RangeVal {
    const ma = /^([A-Z]+)(\d+)$/.exec(a)!;
    const mb = /^([A-Z]+)(\d+)$/.exec(b)!;
    const c1 = Math.min(colToNum(ma[1]), colToNum(mb[1]));
    const c2 = Math.max(colToNum(ma[1]), colToNum(mb[1]));
    const r1 = Math.min(+ma[2], +mb[2]);
    const r2 = Math.max(+ma[2], +mb[2]);
    const range: RangeVal["range"] = [];
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const ref = numToCol(c) + r;
        const cell = this.cells[ref];
        if (!cell && !(ref in this.overrides)) continue;
        range.push({ ref, value: this.get(ref), isSubtotal: !!cell?.f && /SUBTOTAL\s*\(/i.test(cell.f) });
      }
    return { range };
  }

  private flatNums(args: Val[], skipSubtotals = false): number[] | XlError {
    const out: number[] = [];
    for (const a of args) {
      if (isErr(a)) return a;
      if (isRange(a)) {
        for (const item of a.range) {
          if (skipSubtotals && item.isSubtotal) continue;
          if (isErr(item.value)) return item.value;
          if (typeof item.value === "number") out.push(item.value);
        }
      } else if (a !== null && a !== "") {
        const n = toNum(a as Prim);
        if (isErr(n)) return n;
        out.push(n);
      }
    }
    return out;
  }

  private evalNode(node: Node): Val {
    switch (node.k) {
      case "lit":
        return node.v;
      case "ref":
        return this.get(node.ref);
      case "range":
        return this.rangeOf(node.a, node.b);
      case "neg": {
        const v = this.scalar(this.evalNode(node.e));
        const n = toNum(v);
        return isErr(n) ? n : -n;
      }
      case "pct": {
        const n = toNum(this.scalar(this.evalNode(node.e)));
        return isErr(n) ? n : n / 100;
      }
      case "bin":
        return this.binary(node.op, this.scalar(this.evalNode(node.l)), this.scalar(this.evalNode(node.r)));
      case "fn":
        return this.call(node.name, node.args);
    }
  }

  private scalar(v: Val): Prim | XlError {
    if (isRange(v)) return v.range.length === 1 ? v.range[0].value : { error: "#VALUE!" };
    return v;
  }

  private binary(op: string, l: Prim | XlError, r: Prim | XlError): Prim | XlError {
    if (isErr(l)) return l;
    if (isErr(r)) return r;
    if (op === "&") return `${l ?? ""}${r ?? ""}`;
    if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
      const a = typeof l === "string" ? l.toLowerCase() : l ?? 0;
      const b = typeof r === "string" ? r.toLowerCase() : r ?? 0;
      const la = l === null && typeof r === "string" ? "" : a;
      const rb = r === null && typeof l === "string" ? "" : b;
      switch (op) {
        case "=":
          return la === rb;
        case "<>":
          return la !== rb;
        case "<":
          return (la as number) < (rb as number);
        case ">":
          return (la as number) > (rb as number);
        case "<=":
          return (la as number) <= (rb as number);
        default:
          return (la as number) >= (rb as number);
      }
    }
    const a = toNum(l);
    const b = toNum(r);
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? { error: "#DIV/0!" } : a / b;
      case "^":
        return Math.pow(a, b);
    }
    return { error: "#VALUE!" };
  }

  private call(name: string, argNodes: Node[]): Val {
    const lazy = (i: number) => (argNodes[i] ? this.evalNode(argNodes[i]) : null);
    const args = () => argNodes.map((a) => this.evalNode(a));
    const sum = (nums: number[] | XlError) => (isErr(nums) ? nums : nums.reduce((s, x) => s + x, 0));
    const truthy = (v: Prim | XlError) => (isErr(v) ? v : typeof v === "string" ? v !== "" : !!v);
    switch (name) {
      case "SUM":
        return sum(this.flatNums(args()));
      case "SUBTOTAL": {
        const kind = toNum(this.scalar(lazy(0)));
        if (isErr(kind)) return kind;
        const nums = this.flatNums(argNodes.slice(1).map((a) => this.evalNode(a)), true);
        if (isErr(nums)) return nums;
        const k = kind % 100;
        if (k === 9) return sum(nums);
        if (k === 1) return nums.length ? sum(nums) as number / nums.length : { error: "#DIV/0!" };
        if (k === 2) return nums.length;
        if (k === 4) return nums.length ? Math.max(...nums) : 0;
        if (k === 5) return nums.length ? Math.min(...nums) : 0;
        return { error: "#N/A" };
      }
      case "AVERAGE": {
        const nums = this.flatNums(args());
        return isErr(nums) ? nums : nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : { error: "#DIV/0!" };
      }
      case "MIN":
      case "MAX": {
        const nums = this.flatNums(args());
        if (isErr(nums)) return nums;
        return nums.length ? (name === "MIN" ? Math.min(...nums) : Math.max(...nums)) : 0;
      }
      case "PRODUCT": {
        const nums = this.flatNums(args());
        return isErr(nums) ? nums : nums.reduce((s, x) => s * x, 1);
      }
      case "COUNT": {
        const nums = this.flatNums(args());
        return isErr(nums) ? nums : nums.length;
      }
      case "ABS": {
        const n = toNum(this.scalar(lazy(0)));
        return isErr(n) ? n : Math.abs(n);
      }
      case "ROUND":
      case "ROUNDUP":
      case "ROUNDDOWN": {
        const n = toNum(this.scalar(lazy(0)));
        const d = toNum(this.scalar(lazy(1)));
        if (isErr(n)) return n;
        if (isErr(d)) return d;
        const f = Math.pow(10, d);
        const fnR = name === "ROUND" ? Math.round : name === "ROUNDUP" ? (x: number) => Math.sign(x) * Math.ceil(Math.abs(x)) : (x: number) => Math.sign(x) * Math.floor(Math.abs(x));
        return fnR(n * f) / f;
      }
      case "IF": {
        const c = truthy(this.scalar(lazy(0)));
        if (isErr(c)) return c;
        return c ? (argNodes[1] ? this.evalNode(argNodes[1]) : true) : argNodes[2] ? this.evalNode(argNodes[2]) : false;
      }
      case "IFERROR": {
        const v = this.scalar(lazy(0));
        return isErr(v) ? this.evalNode(argNodes[1]) : v;
      }
      case "AND":
      case "OR": {
        const vals = args().map((a) => truthy(this.scalar(a)));
        const err = vals.find(isErr);
        if (err) return err;
        return name === "AND" ? vals.every(Boolean) : vals.some(Boolean);
      }
      case "NOT": {
        const v = truthy(this.scalar(lazy(0)));
        return isErr(v) ? v : !v;
      }
      case "SUMPRODUCT": {
        const ranges = args().filter(isRange) as RangeVal[];
        if (!ranges.length) return 0;
        const len = ranges[0].range.length;
        let total = 0;
        for (let i = 0; i < len; i++) {
          let prod = 1;
          for (const r of ranges) {
            const n = toNum(r.range[i]?.value ?? 0);
            prod *= isErr(n) ? 0 : n;
          }
          total += prod;
        }
        return total;
      }
      case "CONCATENATE":
        return args().map((a) => String(this.scalar(a) ?? "")).join("");
      default:
        throw new Error("função não suportada: " + name);
    }
  }
}
