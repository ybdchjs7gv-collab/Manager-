// Einkaufsliste: Kategorie erraten und Menge vom Artikel trennen.

export const SHOPPING_CATEGORIES = [
  "Obst & Gemüse",
  "Brot & Backwaren",
  "Milch & Kühlregal",
  "Fleisch & Fisch",
  "Tiefkühl",
  "Vorrat & Konserven",
  "Getränke",
  "Süßes & Snacks",
  "Drogerie",
  "Haushalt",
  "Sonstiges",
] as const;

export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

const KEYWORDS: [ShoppingCategory, string[]][] = [
  ["Obst & Gemüse", ["apfel", "äpfel", "banane", "birne", "orange", "zitrone", "limette", "traube", "beere", "erdbeer", "himbeer", "heidelbeer", "kiwi", "mango", "ananas", "melone", "pfirsich", "pflaume", "tomate", "gurke", "salat", "rucola", "spinat", "paprika", "zwiebel", "knoblauch", "kartoffel", "karotte", "möhre", "zucchini", "aubergine", "brokkoli", "blumenkohl", "kohl", "lauch", "porree", "sellerie", "pilz", "champignon", "avocado", "ingwer", "kräuter", "petersilie", "basilikum", "schnittlauch", "koriander", "radieschen", "kürbis", "süßkartoffel", "mais", "erbsen", "bohnen grün", "obst", "gemüse", "rote bete"]],
  ["Brot & Backwaren", ["brot", "brötchen", "toast", "baguette", "croissant", "brezel", "laugen", "semmel", "knäcke", "tortilla", "wraps", "fladenbrot", "kuchen"]],
  ["Milch & Kühlregal", ["milch", "joghurt", "quark", "sahne", "butter", "käse", "mozzarella", "feta", "parmesan", "frischkäse", "schmand", "creme fraiche", "crème fraîche", "ei", "eier", "tofu", "hafermilch", "skyr", "kefir", "margarine", "aufstrich", "hummus", "pesto"]],
  ["Fleisch & Fisch", ["fleisch", "hähnchen", "huhn", "pute", "rind", "hack", "schwein", "wurst", "salami", "schinken", "speck", "bacon", "lachs", "fisch", "thunfisch frisch", "garnelen", "shrimps", "steak", "schnitzel", "würstchen", "aufschnitt"]],
  ["Tiefkühl", ["tiefkühl", "tk-", "tk ", "pizza", "eis", "pommes", "fischstäbchen", "gefroren"]],
  ["Vorrat & Konserven", ["nudeln", "pasta", "spaghetti", "reis", "mehl", "zucker", "salz", "pfeffer", "öl", "essig", "linsen", "kichererbsen", "bohnen", "dose", "konserve", "passierte", "tomatenmark", "brühe", "gewürz", "haferflocken", "müsli", "cornflakes", "honig", "marmelade", "nutella", "senf", "ketchup", "mayo", "soße", "sauce", "hefe", "backpulver", "nüsse", "mandeln", "couscous", "bulgur", "quinoa", "thunfisch", "kokosmilch", "sojasauce", "kaffee", "tee", "kakao"]],
  ["Getränke", ["wasser", "sprudel", "saft", "cola", "limo", "bier", "wein", "sekt", "schorle", "getränk", "smoothie", "eistee"]],
  ["Süßes & Snacks", ["schokolade", "chips", "kekse", "gummibärchen", "bonbon", "riegel", "snack", "süßigkeiten", "popcorn", "cracker", "salzstangen"]],
  ["Drogerie", ["shampoo", "duschgel", "seife", "zahnpasta", "zahnbürste", "deo", "creme", "sonnencreme", "rasier", "tampon", "binden", "windeln", "taschentücher", "watte", "pflaster", "tabletten", "vitamin", "make-up", "wattestäbchen", "haargummi", "spülung"]],
  ["Haushalt", ["spülmittel", "waschmittel", "weichspüler", "müllbeutel", "müllsack", "toilettenpapier", "klopapier", "küchenrolle", "schwamm", "reiniger", "putzmittel", "alufolie", "frischhaltefolie", "backpapier", "batterien", "glühbirne", "kerzen", "spültabs", "entkalker", "servietten"]],
];

export function guessCategory(name: string): ShoppingCategory {
  const n = ` ${name.toLowerCase()} `;
  for (const [category, words] of KEYWORDS) {
    for (const w of words) {
      if (w.length <= 3 ? new RegExp(`[\\s-]${w}[\\s,.]`).test(n) : n.includes(w)) return category;
    }
  }
  return "Sonstiges";
}

const QTY_RE = /^\s*(\d+(?:[.,]\d+)?|ein(?:e|en)?|zwei|drei|vier|fünf|½|\d+\/\d+)\s*(kg|g|gr|l|ml|liter|stk\.?|stück|pck\.?|packung(?:en)?|pkg|dose[n]?|flasche[n]?|bund|becher|glas|gläser|netz|tüte[n]?|x)?\s+(.+)$/i;
const QTY_SUFFIX_RE = /^(.+?)\s+(\d+(?:[.,]\d+)?\s*(?:kg|g|gr|l|ml|stk\.?|stück|x|packungen?|dosen?|flaschen?))$/i;

/** "2 l Milch" → { name: "Milch", quantity: "2 l" } */
export function splitQuantity(input: string): { name: string; quantity: string | null } {
  const text = input.trim().replace(/\s+/g, " ");
  const m = QTY_RE.exec(text);
  if (m) {
    const quantity = [m[1], m[2]].filter(Boolean).join(" ");
    return { name: capitalize(m[3]), quantity };
  }
  const s = QTY_SUFFIX_RE.exec(text);
  if (s) return { name: capitalize(s[1]), quantity: s[2] };
  return { name: capitalize(text), quantity: null };
}

/** Splits "Milch, 6 Eier und Brot" into single items. */
export function splitItems(input: string): { name: string; quantity: string | null; category: ShoppingCategory }[] {
  return input
    .split(/[,;\n]|\s+und\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const { name, quantity } = splitQuantity(part);
      return { name, quantity, category: guessCategory(name) };
    });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Merges ingredient amounts like "200 g" + "300 g" → "500 g"; otherwise joins them. */
export function mergeQuantities(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const re = /^(\d+(?:[.,]\d+)?)\s*(.*)$/;
  const ma = re.exec(a.trim());
  const mb = re.exec(b.trim());
  if (ma && mb && ma[2].toLowerCase() === mb[2].toLowerCase()) {
    const sum = Number(ma[1].replace(",", ".")) + Number(mb[1].replace(",", "."));
    return `${Number.isInteger(sum) ? sum : sum.toFixed(1).replace(".", ",")}${ma[2] ? ` ${ma[2]}` : ""}`;
  }
  return `${a} + ${b}`;
}
