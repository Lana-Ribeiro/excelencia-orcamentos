// Biblioteca de referência para preenchimento guiado.
// Disciplinas (nível 2) → grupos (nível 3) → itens típicos (nível 4) e os campos de
// especificação que o orçamentista precisa levantar em cada tipo de serviço.
// Baseada em planilhas reais de orçamento e em práticas de obras de varejo/retrofit
// em shopping.

export interface SpecField {
  key: string;
  hint?: string;
  options?: string[];
}

export interface CatalogItem {
  description: string;
  unit: string;
  specs?: string[]; // chaves de SpecField
}

export interface CatalogGroup {
  name: string;
  items: CatalogItem[];
}

export interface CatalogDiscipline {
  name: string;
  keywords: string[];
  groups: CatalogGroup[];
  specs: string[]; // campos padrão da disciplina
}

export const UNITS = ["un", "vb", "m²", "m", "ml", "m³", "pontos", "pç", "cj", "kg", "dia", "mês", "h", "TR", "lote"];

export const SPEC_FIELDS: Record<string, SpecField> = {
  Cor: { key: "Cor", hint: "nome comercial e código" },
  "Referência": { key: "Referência", hint: "código do fabricante / linha" },
  Marca: { key: "Marca", hint: "fabricante ou fornecedor homologado" },
  Acabamento: { key: "Acabamento", options: ["Fosco", "Acetinado", "Semibrilho", "Brilhante", "Escovado", "Polido", "Natural", "Laqueado"] },
  "Dimensões": { key: "Dimensões", hint: "L × A × P (mm)" },
  Ambiente: { key: "Ambiente", options: ["Salão de vendas", "Vitrine", "Provador", "Caixa", "Estoque", "Copa", "Fachada", "Mezanino", "Área técnica"] },
  Material: { key: "Material" },
  Espessura: { key: "Espessura", hint: "mm" },
  "Perda considerada": { key: "Perda considerada", options: ["5%", "10%", "15%", "20%"] },
  "Paginação": { key: "Paginação", options: ["Reta", "Amarração 1/2", "Amarração 1/3", "Diagonal", "Espinha de peixe", "Conforme projeto"] },
  Formato: { key: "Formato", hint: "ex.: 120×120 cm" },
  Rejunte: { key: "Rejunte", hint: "cor e espessura da junta" },
  // Elétrica
  Bitola: { key: "Bitola", options: ["1,5 mm²", "2,5 mm²", "4 mm²", "6 mm²", "10 mm²", "16 mm²", "25 mm²"] },
  "Cor do fio": { key: "Cor do fio", options: ["Fase – preto", "Fase – vermelho", "Fase – branco", "Neutro – azul claro", "Terra – verde/amarelo", "Retorno – cinza"] },
  "Tipo de cabo": { key: "Tipo de cabo", options: ["Flexível 750V", "Flexível 1kV (PP)", "Cabo antichama LSZH", "Rígido"] },
  "Tensão": { key: "Tensão", options: ["127V", "220V", "380V"] },
  Corrente: { key: "Corrente", options: ["10A", "20A", "32A"] },
  "Linha / espelho": { key: "Linha / espelho", hint: "linha do fabricante e cor do espelho" },
  "Altura de instalação": { key: "Altura de instalação", options: ["Piso", "30 cm", "110 cm", "Bancada", "Forro"] },
  Eletroduto: { key: "Eletroduto", options: ["Corrugado 3/4\"", "Rígido PVC 3/4\"", "Galvanizado 3/4\"", "Perfilado 38×38", "Eletrocalha"] },
  "Temperatura de cor": { key: "Temperatura de cor", options: ["2700K", "3000K", "3500K", "4000K", "5000K"] },
  IRC: { key: "IRC", options: ["> 80", "> 90", "> 95"] },
  "Potência": { key: "Potência", hint: "W" },
  "Dimerização": { key: "Dimerização", options: ["Não dimerizável", "Dimmer TRIAC", "0-10V", "DALI"] },
  // Climatização
  Capacidade: { key: "Capacidade", hint: "BTU/h ou TR" },
  "Tipo de equipamento": { key: "Tipo de equipamento", options: ["Split hi-wall", "Split cassete", "Split piso-teto", "Fan coil", "VRF", "Self contained"] },
  // Incêndio
  "Tipo de sprinkler": { key: "Tipo de sprinkler", options: ["Pendente", "Upright", "Oculto", "Lateral"] },
  "Temperatura de acionamento": { key: "Temperatura de acionamento", options: ["57 °C", "68 °C", "79 °C"] },
  "Classe do extintor": { key: "Classe do extintor", options: ["Água pressurizada (A)", "Pó químico ABC", "CO2 (BC)"] },
  // Pintura
  "Código da cor": { key: "Código da cor", hint: "ex.: Suvinil N405 / Coral 10YY 83/029" },
  "Demãos": { key: "Demãos", options: ["1", "2", "3"] },
  Linha: { key: "Linha", hint: "ex.: Premium, Toque de Seda" },
  // Marcenaria
  "Padrão MDF": { key: "Padrão MDF", hint: "cor/padrão e fabricante" },
  Ferragens: { key: "Ferragens", hint: "corrediças, dobradiças, puxadores" },
  // Vidros
  "Tipo de vidro": { key: "Tipo de vidro", options: ["Temperado incolor", "Laminado incolor", "Temperado extra clear", "Espelho prata", "Espelho bronze"] },
};

const disc = (name: string, keywords: string[], specs: string[], groups: CatalogGroup[]): CatalogDiscipline => ({
  name,
  keywords,
  specs,
  groups,
});

export const CATALOG: CatalogDiscipline[] = [
  disc("SERVIÇOS INICIAIS", ["inicia", "prelimin", "canteiro", "document"], ["Ambiente"], [
    {
      name: "Canteiro de obra",
      items: [
        { description: "Carretos diversos", unit: "un" },
        { description: "EPI's e EPC", unit: "vb" },
        { description: "Equipamentos gerais para obra", unit: "vb" },
        { description: "Implantação do canteiro de obra", unit: "vb" },
        { description: "Proteção de piso e mobiliário", unit: "vb" },
        { description: "Tapume em eucatex", unit: "m²", specs: ["Acabamento", "Dimensões"] },
        { description: "Caçambas para descarte", unit: "un" },
      ],
    },
    {
      name: "Documentações",
      items: [
        { description: "ART", unit: "vb" },
        { description: "Seguro de obra", unit: "vb" },
        { description: "Cópias e plotagens de projeto", unit: "vb" },
      ],
    },
  ]),
  disc("CIVIL", ["civil", "demoli", "alvenaria", "drywall", "contrapiso"], ["Material", "Espessura", "Ambiente"], [
    {
      name: "Demolição",
      items: [
        { description: "Demolição de piso e contrapiso", unit: "m²" },
        { description: "Demolição de forro de gesso", unit: "m²" },
        { description: "Demolição de paredes em drywall/alvenaria", unit: "m²" },
        { description: "Caçambas para descarte", unit: "un" },
      ],
    },
    {
      name: "Remoção",
      items: [{ description: "Remoção de mobiliário e itens decorativos", unit: "vb" }],
    },
    {
      name: "Vedações e regularizações",
      items: [
        { description: "Parede em drywall (montante 70 mm, placa ST)", unit: "m²", specs: ["Espessura", "Material"] },
        { description: "Regularização de contrapiso", unit: "m²", specs: ["Espessura"] },
      ],
    },
  ]),
  disc("ELÉTRICA", ["elétri", "eletri", "tomada", "ilumina", "quadro", "automa", "cabo"], ["Tensão", "Marca"], [
    {
      name: "Quadros e infraestrutura",
      items: [
        { description: "Quadro de distribuição", unit: "un", specs: ["Tensão", "Marca", "Dimensões"] },
        { description: "Infraestrutura com eletrodutos e perfilados", unit: "m", specs: ["Eletroduto"] },
        { description: "Cabeamento elétrico", unit: "m", specs: ["Bitola", "Cor do fio", "Tipo de cabo", "Marca"] },
      ],
    },
    {
      name: "Instalação de tomadas e pontos",
      items: [
        { description: "Infra e instalação de tomadas no piso", unit: "pontos", specs: ["Corrente", "Linha / espelho", "Altura de instalação"] },
        { description: "Ponto de tomada de parede", unit: "pontos", specs: ["Corrente", "Tensão", "Linha / espelho", "Altura de instalação"] },
        { description: "Ponto de iluminação", unit: "pontos", specs: ["Eletroduto", "Bitola"] },
      ],
    },
    {
      name: "Iluminação",
      items: [
        { description: "Instalação de luminárias conforme projeto", unit: "un", specs: ["Temperatura de cor", "IRC", "Potência", "Dimerização", "Marca"] },
        { description: "Fita de LED em sanca", unit: "m", specs: ["Temperatura de cor", "Potência", "Dimerização"] },
      ],
    },
    {
      name: "Automação",
      items: [{ description: "Instalação de timer para luminárias", unit: "vb", specs: ["Dimerização"] }],
    },
    {
      name: "Mão de obra",
      items: [{ description: "Eletricista para acompanhamento da obra", unit: "dia" }],
    },
  ]),
  disc("LÓGICA, SOM E CFTV", ["lógica", "logica", "dados", "cftv", "som", "ti "], ["Marca"], [
    {
      name: "Cabeamento estruturado",
      items: [
        { description: "Ponto de dados Cat6", unit: "pontos", specs: ["Marca", "Cor"] },
        { description: "Cabeamento para sonorização", unit: "vb" },
        { description: "Infraestrutura para CFTV", unit: "vb" },
      ],
    },
  ]),
  disc("CLIMATIZAÇÃO", ["ar-cond", "ar cond", "climat", "duto", "exaust"], ["Capacidade", "Tipo de equipamento", "Marca"], [
    {
      name: "Ar-condicionado",
      items: [
        { description: "Fornecimento de equipamento de ar-condicionado", unit: "un", specs: ["Capacidade", "Tipo de equipamento", "Marca"] },
        { description: "Rede de dutos e difusores", unit: "vb", specs: ["Material"] },
        { description: "Manutenção e limpeza de equipamentos existentes", unit: "vb" },
      ],
    },
  ]),
  disc("COMBATE A INCÊNDIO", ["incêndio", "incendio", "sprinkler", "extintor", "ppci"], ["Marca"], [
    {
      name: "Sprinklers e detecção",
      items: [
        { description: "Remanejamento/instalação de sprinkler", unit: "un", specs: ["Tipo de sprinkler", "Temperatura de acionamento", "Acabamento"] },
        { description: "Detector de fumaça", unit: "un", specs: ["Marca"] },
      ],
    },
    {
      name: "Extintores e sinalização",
      items: [
        { description: "Extintor", unit: "un", specs: ["Classe do extintor"] },
        { description: "Sinalização de emergência fotoluminescente", unit: "un" },
      ],
    },
  ]),
  disc("PISO", ["piso", "sisal", "porcelanato", "vinílico", "vinilico", "carpete", "granilite", "rodapé"], ["Cor", "Referência", "Marca", "Paginação", "Perda considerada"], [
    {
      name: "Revestimento de piso",
      items: [
        { description: "Instalação de piso em sisal", unit: "m²", specs: ["Cor", "Referência", "Perda considerada"] },
        { description: "Assentamento de porcelanato", unit: "m²", specs: ["Formato", "Cor", "Referência", "Acabamento", "Rejunte", "Paginação", "Perda considerada"] },
        { description: "Instalação de piso vinílico", unit: "m²", specs: ["Espessura", "Cor", "Referência", "Paginação"] },
        { description: "Carpete em placas", unit: "m²", specs: ["Cor", "Referência", "Marca"] },
      ],
    },
    {
      name: "Acabamentos de piso",
      items: [
        { description: "Perfil metálico de acabamento", unit: "ml", specs: ["Material", "Acabamento"] },
        { description: "Rodapé", unit: "ml", specs: ["Material", "Dimensões", "Acabamento"] },
        { description: "Soleira", unit: "m²", specs: ["Material", "Acabamento"] },
      ],
    },
  ]),
  disc("FORRO", ["forro", "gesso", "sanca", "tabica"], ["Material", "Acabamento"], [
    {
      name: "Gesso",
      items: [
        { description: "Forro de gesso acartonado", unit: "m²", specs: ["Material", "Espessura"] },
        { description: "Execução de sanca/cortineiro", unit: "ml" },
        { description: "Alçapão de inspeção", unit: "un", specs: ["Dimensões"] },
      ],
    },
    {
      name: "Pintura de forro",
      items: [{ description: "Pintura de forro", unit: "m²", specs: ["Código da cor", "Acabamento", "Marca", "Demãos"] }],
    },
  ]),
  disc("PINTURA E REVESTIMENTOS", ["pintura", "textura", "revestimento", "papel de parede"], ["Código da cor", "Acabamento", "Marca"], [
    {
      name: "Pintura",
      items: [
        { description: "Pintura de paredes", unit: "m²", specs: ["Código da cor", "Acabamento", "Marca", "Linha", "Demãos"] },
        { description: "Aplicação de textura", unit: "m²", specs: ["Referência", "Cor", "Marca"] },
      ],
    },
    {
      name: "Revestimentos de parede",
      items: [{ description: "Papel de parede", unit: "m²", specs: ["Referência", "Cor", "Marca"] }],
    },
  ]),
  disc("MARCENARIA", ["marcenaria", "mobili", "móvel", "movel"], ["Padrão MDF", "Ferragens", "Dimensões"], [
    {
      name: "Mobiliário",
      items: [
        { description: "Móvel sob medida", unit: "un", specs: ["Padrão MDF", "Ferragens", "Dimensões", "Acabamento"] },
        { description: "Instalação de mobiliário fornecido pelo cliente", unit: "vb" },
      ],
    },
  ]),
  disc("SERRALHERIA E METAIS", ["serralh", "metál", "metal", "inox", "frame", "estrutura"], ["Material", "Acabamento", "Espessura"], [
    {
      name: "Serralheria",
      items: [
        { description: "Frame em aço inox", unit: "un", specs: ["Material", "Acabamento", "Dimensões"] },
        { description: "Estrutura metálica auxiliar", unit: "kg", specs: ["Material", "Acabamento"] },
        { description: "Corrimão", unit: "ml", specs: ["Material", "Acabamento"] },
      ],
    },
  ]),
  disc("VIDROS E ESPELHOS", ["vidro", "espelho", "vitrine"], ["Tipo de vidro", "Espessura", "Dimensões"], [
    {
      name: "Vidros",
      items: [
        { description: "Vidro temperado", unit: "m²", specs: ["Tipo de vidro", "Espessura", "Dimensões"] },
        { description: "Espelho", unit: "m²", specs: ["Tipo de vidro", "Espessura", "Dimensões"] },
      ],
    },
  ]),
  disc("COMUNICAÇÃO VISUAL", ["letreiro", "lightbox", "adesiv", "comunicação"], ["Material", "Dimensões"], [
    {
      name: "Fachada",
      items: [
        { description: "Instalação de letreiro", unit: "vb", specs: ["Dimensões"] },
        { description: "Lightbox", unit: "un", specs: ["Dimensões", "Temperatura de cor"] },
      ],
    },
  ]),
  disc("LIMPEZA", ["limpeza"], ["Ambiente"], [
    {
      name: "Limpeza",
      items: [
        { description: "Limpeza fina final", unit: "dia" },
        { description: "Limpeza periódica de obra", unit: "mês" },
      ],
    },
  ]),
  disc("EQUIPE TÉCNICA + LOGÍSTICA", ["equipe", "logíst", "logist", "administra", "mobiliza"], [], [
    {
      name: "Equipe técnica",
      items: [
        { description: "Administração e Coordenação", unit: "mês" },
        { description: "Engenheiro de obra", unit: "mês" },
        { description: "Mestre de obra", unit: "mês" },
        { description: "Ajudantes (limpeza, organização e movimentação)", unit: "mês" },
      ],
    },
    {
      name: "Mobilização de equipe",
      items: [
        { description: "Transporte", unit: "mês" },
        { description: "Alimentação", unit: "mês" },
        { description: "Estacionamento", unit: "mês" },
        { description: "Hospedagem", unit: "mês" },
      ],
    },
  ]),
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Encontra a disciplina do catálogo que corresponde a um nome livre. */
export function matchDiscipline(name: string): CatalogDiscipline | undefined {
  const s = norm(name);
  return (
    CATALOG.find((d) => norm(d.name) === s) ??
    CATALOG.find((d) => d.keywords.some((k) => s.includes(norm(k))))
  );
}

/** Campos de especificação sugeridos para um item (pelo nome e disciplina). */
export function suggestSpecFields(discipline: string, itemDescription: string): string[] {
  const d = matchDiscipline(discipline);
  const s = norm(itemDescription);
  const fields = new Set<string>();
  if (d) {
    for (const g of d.groups)
      for (const it of g.items) {
        const words = norm(it.description).split(/\s+/).filter((w) => w.length > 4);
        if (words.some((w) => s.includes(w))) it.specs?.forEach((k) => fields.add(k));
      }
    d.specs.forEach((k) => fields.add(k));
  }
  // palavras-chave transversais
  if (/cabo|fio|cabeamento/.test(s)) ["Bitola", "Cor do fio", "Tipo de cabo"].forEach((k) => fields.add(k));
  if (/tomada/.test(s)) ["Corrente", "Linha / espelho", "Altura de instalação"].forEach((k) => fields.add(k));
  if (/lumin|led|ilumina/.test(s)) ["Temperatura de cor", "IRC", "Potência"].forEach((k) => fields.add(k));
  if (/pintura|tinta/.test(s)) ["Código da cor", "Acabamento", "Marca"].forEach((k) => fields.add(k));
  if (/piso|porcelanato|revest/.test(s)) ["Cor", "Referência", "Paginação"].forEach((k) => fields.add(k));
  ["Cor", "Referência", "Marca", "Ambiente"].forEach((k) => fields.add(k));
  return [...fields];
}

export function suggestItems(discipline: string, group: string): CatalogItem[] {
  const d = matchDiscipline(discipline);
  if (!d) return [];
  const g = norm(group);
  const exact = d.groups.find((x) => norm(x.name) === g) ?? d.groups.find((x) => g.includes(norm(x.name).split(" ")[0]));
  return exact ? exact.items : d.groups.flatMap((x) => x.items);
}
