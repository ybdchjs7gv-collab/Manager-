import { ChefHat, Plus, Share2, ShoppingCart, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { addShoppingItems, ingredientsToItems } from "../../lib/actions";
import { addDaysStr, todayStr } from "../../lib/dates";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import { SHOPPING_CATEGORIES, splitItems } from "../../lib/shopping";
import type { ShoppingItem } from "../../lib/types";
import { Button, Card, Check, Empty, Loading, useAction, useToast } from "../ui";

export function ShoppingView() {
  const items = useLive(["shopping_items"], () => db().list("shopping_items", { order: [["created_at", "asc"]] }));
  const [text, setText] = useState("");
  const { busy, run } = useAction();
  const toast = useToast();

  const open = (items.data ?? []).filter((i) => !i.checked);
  const done = (items.data ?? []).filter((i) => i.checked);
  const grouped = useMemo(() => {
    const order = [...SHOPPING_CATEGORIES] as string[];
    const map = new Map<string, ShoppingItem[]>();
    for (const i of open) map.set(i.category, [...(map.get(i.category) ?? []), i]);
    const rank = (category: string) => (order.includes(category) ? order.indexOf(category) : order.length);
    return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [open]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const parsed = splitItems(text);
    if (parsed.length === 0) return;
    void run("add", async () => {
      await addShoppingItems(parsed);
      setText("");
    });
  };

  const toggle = (item: ShoppingItem) =>
    run(`t-${item.id}`, async () => {
      await db().update("shopping_items", [["id", "eq", item.id]], { checked: !item.checked, checked_at: item.checked ? null : new Date().toISOString() });
      invalidate("shopping_items");
    });

  const fromMealPlan = () =>
    run("meals", async () => {
      const today = todayStr();
      const meals = await db().list("meal_plan", { where: [["day", "gte", today], ["day", "lte", addDaysStr(today, 7)]] });
      const recipeIds = [...new Set(meals.map((m) => m.recipe_id).filter(Boolean))] as string[];
      if (recipeIds.length === 0) throw new Error("Im Essensplan der nächsten 7 Tage sind keine Rezepte mit Zutaten.");
      const recipes = await db().list("recipes", { where: [["id", "in", recipeIds]] });
      const already = new Set((items.data ?? []).filter((i) => i.recipe_id).map((i) => `${i.recipe_id}|${i.name.toLowerCase()}`));
      const toAdd = recipes.flatMap((r) => ingredientsToItems(r.ingredients, r.id)).filter((i) => !already.has(`${i.recipe_id}|${i.name.toLowerCase()}`));
      await addShoppingItems(toAdd);
      toast.show(toAdd.length > 0 ? `${toAdd.length} Zutaten ergänzt` : "Alle Zutaten stehen schon drauf");
    });

  const share = async () => {
    const lines = grouped.flatMap(([cat, list]) => [`${cat}:`, ...list.map((i) => `• ${i.quantity ? `${i.quantity} ` : ""}${i.name}`), ""]);
    const textToShare = `Einkaufsliste\n\n${lines.join("\n")}`.trim();
    if (navigator.share) await navigator.share({ title: "Einkaufsliste", text: textToShare }).catch(() => undefined);
    else await navigator.clipboard.writeText(textToShare).then(() => toast.show("Liste kopiert"));
  };

  return (
    <div className="stack">
      <form className="quick-add" onSubmit={add}>
        <ShoppingCart size={18} className="muted" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. 2 l Milch, Brot und Äpfel" aria-label="Artikel hinzufügen" enterKeyHint="done" />
        <Button type="submit" variant="primary" size="sm" icon={<Plus size={17} />} loading={busy === "add"} aria-label="Hinzufügen" />
      </form>
      <div className="row wrap">
        <Button size="sm" icon={<ChefHat size={16} />} loading={busy === "meals"} onClick={fromMealPlan}>Zutaten aus dem Essensplan</Button>
        {open.length > 0 && <Button size="sm" icon={<Share2 size={16} />} onClick={() => void share()}>Teilen</Button>}
      </div>
      {items.loading && !items.data ? (
        <Loading rows={4} />
      ) : open.length === 0 && done.length === 0 ? (
        <Empty icon={<ShoppingCart size={24} />} title="Die Einkaufsliste ist leer" text="Füge oben Artikel hinzu oder übernimm die Zutaten aus dem Essensplan." />
      ) : (
        <>
          {grouped.map(([category, list]) => (
            <Card key={category} title={category}>
              <div className="list">
                {list.map((item) => (
                  <div key={item.id} className="list-row clickable" onClick={() => void toggle(item)}>
                    <Check square done={false} onToggle={() => void toggle(item)} label={`${item.name} abhaken`} />
                    <span className="grow">{item.name}</span>
                    {item.quantity && <span className="small muted">{item.quantity}</span>}
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {done.length > 0 && (
            <Card
              title={<span className="muted">Im Wagen ({done.length})</span>}
              action={
                <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} loading={busy === "clear"} onClick={() => run("clear", async () => {
                  await db().remove("shopping_items", [["checked", "eq", true]]);
                  invalidate("shopping_items");
                })}>
                  Entfernen
                </Button>
              }
            >
              <div className="list">
                {done.map((item) => (
                  <div key={item.id} className="list-row clickable" onClick={() => void toggle(item)}>
                    <Check square done onToggle={() => void toggle(item)} label={`${item.name} zurücklegen`} />
                    <span className="grow done-text">{item.name}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
