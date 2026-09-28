import { BookOpen, ChefHat, ChevronLeft, ChevronRight, Plus, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { addShoppingItems, ingredientsToItems } from "../../lib/actions";
import { callAi, useAiStatus } from "../../lib/ai";
import { useApp } from "../../lib/app-state";
import { addDaysStr, formatDayShort, isoWeekday, startOfWeekStr, todayStr, WEEKDAY_LABELS } from "../../lib/dates";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import { mealsBetween } from "../../lib/queries";
import { guessCategory, splitQuantity } from "../../lib/shopping";
import type { Ingredient, MealPlanEntry, Recipe } from "../../lib/types";
import { Button, Card, Field, Notice, Sheet, Toggle, useAction, useToast } from "../ui";

export function parseIngredientLine(line: string): Ingredient | null {
  const text = line.trim().replace(/^[-•*]\s*/, "");
  if (!text) return null;
  const { name, quantity } = splitQuantity(text);
  const m = quantity ? /^(\S+)\s*(.*)$/.exec(quantity) : null;
  return { name, amount: m?.[1] ?? "", unit: m?.[2] ?? "", category: guessCategory(name) };
}

function ingredientLine(i: Ingredient): string {
  return [i.amount, i.unit, i.name].filter(Boolean).join(" ");
}

export function MealsView() {
  const [weekStart, setWeekStart] = useState(startOfWeekStr(todayStr()));
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
  const meals = useLive(["meal_plan"], () => mealsBetween(days[0], days[6]), [weekStart]);
  const recipes = useLive(["recipes"], () => db().list("recipes", { order: [["name", "asc"]] }));
  const ai = useAiStatus();
  const [slot, setSlot] = useState<{ day: string; entry?: MealPlanEntry } | null>(null);
  const [recipe, setRecipe] = useState<Recipe | "new" | null>(null);
  const [planning, setPlanning] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();
  const today = todayStr();

  const toShopping = () =>
    run("shop", async () => {
      const ids = [...new Set((meals.data ?? []).filter((m) => m.day >= today && m.recipe_id).map((m) => m.recipe_id!))];
      const list = (recipes.data ?? []).filter((r) => ids.includes(r.id));
      const items = list.flatMap((r) => ingredientsToItems(r.ingredients, r.id));
      if (items.length === 0) throw new Error("Für diese Woche sind keine Rezepte mit Zutaten geplant.");
      await addShoppingItems(items);
      toast.show(`${items.length} Zutaten auf die Einkaufsliste gesetzt`);
    });

  return (
    <div className="stack">
      <div className="row between wrap" style={{ gap: 10 }}>
        <div className="row">
          <Button size="sm" icon={<ChevronLeft size={18} />} aria-label="Vorige Woche" onClick={() => setWeekStart(addDaysStr(weekStart, -7))} />
          <span className="strong">{formatDayShort(days[0])} – {formatDayShort(days[6])}</span>
          <Button size="sm" icon={<ChevronRight size={18} />} aria-label="Nächste Woche" onClick={() => setWeekStart(addDaysStr(weekStart, 7))} />
        </div>
        <div className="row wrap">
          <Button size="sm" icon={<ShoppingCart size={16} />} loading={busy === "shop"} onClick={toShopping}>Auf Einkaufsliste</Button>
          {ai.data?.configured && <Button size="sm" variant="primary" icon={<Sparkles size={16} />} onClick={() => setPlanning(true)}>Woche planen</Button>}
        </div>
      </div>

      <Card padded={false}>
        <div className="list">
          {days.map((day, i) => {
            const entries = (meals.data ?? []).filter((m) => m.day === day);
            return (
              <div key={day} className="list-row" style={day === today ? { background: "var(--surface-2)" } : undefined}>
                <div style={{ width: 54 }} className="stack tight">
                  <span className="strong">{WEEKDAY_LABELS[i]}</span>
                  <span className="tiny muted">{formatDayShort(day).split(", ")[1]}</span>
                </div>
                <div className="grow stack tight">
                  {entries.map((m) => (
                    <button key={m.id} className="row" style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer" }} onClick={() => setSlot({ day, entry: m })}>
                      <ChefHat size={16} style={{ color: "var(--k-kochen)" }} />
                      <span className="grow truncate">{m.title}</span>
                      <span className="small muted">{m.meal === "mittag" ? "mittags" : ""} {m.prep_min ? `${m.prep_min} Min.` : ""}</span>
                    </button>
                  ))}
                  {entries.length === 0 && <span className="small faint">Noch nichts geplant</span>}
                </div>
                <Button size="sm" variant="ghost" icon={<Plus size={17} />} aria-label="Gericht eintragen" onClick={() => setSlot({ day })} />
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Rezepte"
        icon={<BookOpen size={18} />}
        action={<Button size="sm" variant="ghost" icon={<Plus size={16} />} onClick={() => setRecipe("new")}>Rezept</Button>}
      >
        {(recipes.data ?? []).length === 0 ? (
          <p className="small muted">Noch keine Rezepte. Lege deine Lieblingsgerichte an oder lass die KI eine Woche planen.</p>
        ) : (
          <div className="list">
            {recipes.data!.map((r) => (
              <button key={r.id} className="list-row" onClick={() => setRecipe(r)}>
                <ChefHat size={17} className="muted" />
                <span className="grow truncate">{r.name}</span>
                <span className="small muted">{r.prep_min} Min. · {r.ingredients.length} Zutaten</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {slot && <MealSlotSheet day={slot.day} entry={slot.entry} recipes={recipes.data ?? []} onClose={() => setSlot(null)} />}
      {recipe && <RecipeSheet recipe={recipe === "new" ? undefined : recipe} onClose={() => setRecipe(null)} />}
      {planning && <AiMealPlanSheet days={days.filter((d) => d >= today)} onClose={() => setPlanning(false)} />}
    </div>
  );
}

function MealSlotSheet({ day, entry, recipes, onClose }: { day: string; entry?: MealPlanEntry; recipes: Recipe[]; onClose: () => void }) {
  const [recipeId, setRecipeId] = useState(entry?.recipe_id ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [meal, setMeal] = useState(entry?.meal ?? "abend");
  const [prep, setPrep] = useState(String(entry?.prep_min ?? 30));
  const { busy, run } = useAction();

  const pick = (id: string) => {
    setRecipeId(id);
    const r = recipes.find((x) => x.id === id);
    if (r) {
      setTitle(r.name);
      setPrep(String(r.prep_min));
    }
  };

  const save = () =>
    run("save", async () => {
      if (!title.trim()) throw new Error("Bitte ein Gericht eintragen.");
      const fields = { day, meal, title: title.trim(), recipe_id: recipeId || null, prep_min: Number(prep) || null };
      const existing = entry ?? (await db().list("meal_plan", { where: [["day", "eq", day], ["meal", "eq", meal]] }))[0];
      if (existing) await db().update("meal_plan", [["id", "eq", existing.id]], fields);
      else await db().insert("meal_plan", [fields]);
      invalidate("meal_plan");
      onClose();
    });

  const remove = () =>
    run("delete", async () => {
      if (!entry) return;
      await db().remove("meal_plan", [["id", "eq", entry.id]]);
      invalidate("meal_plan");
      onClose();
    });

  return (
    <Sheet
      title={`Essen am ${formatDayShort(day)}`}
      onClose={onClose}
      footer={
        <>
          {entry && <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === "delete"} onClick={remove}>Entfernen</Button>}
          <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern</Button>
        </>
      }
    >
      <div className="stack">
        {recipes.length > 0 && (
          <Field label="Aus Rezepten wählen">
            <select className="select" value={recipeId} onChange={(e) => pick(e.target.value)}>
              <option value="">– eigenes Gericht –</option>
              {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Gericht">
          <input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setRecipeId(""); }} placeholder="z. B. Spaghetti Bolognese" />
        </Field>
        <div className="form-grid">
          <Field label="Mahlzeit">
            <select className="select" value={meal} onChange={(e) => setMeal(e.target.value as MealPlanEntry["meal"])}>
              <option value="fruehstueck">Frühstück</option>
              <option value="mittag">Mittag</option>
              <option value="abend">Abend</option>
            </select>
          </Field>
          <Field label="Kochzeit (Min.)">
            <input className="input" type="number" inputMode="numeric" min={0} value={prep} onChange={(e) => setPrep(e.target.value)} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

function RecipeSheet({ recipe, onClose }: { recipe?: Recipe; onClose: () => void }) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [prep, setPrep] = useState(String(recipe?.prep_min ?? 30));
  const [servings, setServings] = useState(String(recipe?.servings ?? 2));
  const [ingredients, setIngredients] = useState((recipe?.ingredients ?? []).map(ingredientLine).join("\n"));
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const { busy, run } = useAction();

  const save = () =>
    run("save", async () => {
      if (!name.trim()) throw new Error("Bitte einen Namen eingeben.");
      const fields = {
        name: name.trim(),
        prep_min: Math.max(1, Number(prep) || 30),
        servings: Math.max(1, Number(servings) || 2),
        ingredients: ingredients.split("\n").map(parseIngredientLine).filter((i): i is Ingredient => Boolean(i)),
        instructions: instructions.trim() || null,
      };
      if (recipe) await db().update("recipes", [["id", "eq", recipe.id]], fields);
      else await db().insert("recipes", [fields]);
      invalidate("recipes");
      onClose();
    }, "Rezept gespeichert");

  const remove = () =>
    run("delete", async () => {
      if (!recipe || !confirm(`Rezept „${recipe.name}“ löschen?`)) return;
      await db().remove("recipes", [["id", "eq", recipe.id]]);
      invalidate("recipes");
      onClose();
    });

  return (
    <Sheet
      title={recipe ? "Rezept" : "Neues Rezept"}
      onClose={onClose}
      footer={
        <>
          {recipe && <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === "delete"} onClick={remove}>Löschen</Button>}
          <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern</Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="form-grid">
          <Field label="Zubereitung (Min.)"><input className="input" type="number" inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} /></Field>
          <Field label="Portionen"><input className="input" type="number" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} /></Field>
        </div>
        <Field label="Zutaten" hint="Eine Zutat pro Zeile, z. B. „200 g Nudeln“">
          <textarea className="textarea" rows={7} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
        </Field>
        <Field label="Zubereitung"><textarea className="textarea" rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

interface PlannedMeal {
  day: string;
  meal: "fruehstueck" | "mittag" | "abend";
  name: string;
  prep_min: number;
  servings: number;
  ingredients: Ingredient[];
  instructions: string;
}

function AiMealPlanSheet({ days, onClose }: { days: string[]; onClose: () => void }) {
  const { settings, saveSettings } = useApp();
  const [persons, setPersons] = useState(String(settings.preferences.persons ?? 2));
  const [diet, setDiet] = useState(settings.preferences.diet ?? "");
  const [dislikes, setDislikes] = useState(settings.preferences.dislikes ?? "");
  const [selected, setSelected] = useState<string[]>(days);
  const [addToList, setAddToList] = useState(true);
  const [result, setResult] = useState<{ meals: PlannedMeal[]; tips: string } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const plan = () =>
    run("plan", async () => {
      if (selected.length === 0) throw new Error("Bitte mindestens einen Tag wählen.");
      await saveSettings({ preferences: { ...settings.preferences, persons: Number(persons) || 2, diet, dislikes } });
      const workDays = new Set(settings.work_days);
      const res = await callAi<{ meals: PlannedMeal[]; tips: string }>("plan_meals", {
        persons: Number(persons) || 2,
        preferences: diet,
        dislikes,
        meals: ["abend"],
        days: selected.map((d) => ({ date: d, note: workDays.has(isoWeekday(d)) ? "Arbeitstag, schnell" : "mehr Zeit" })),
      });
      setResult(res);
    });

  const accept = () =>
    run("save", async () => {
      if (!result) return;
      for (const m of result.meals) {
        const [recipe] = await db().insert("recipes", [{ name: m.name, prep_min: m.prep_min, servings: m.servings, ingredients: m.ingredients, instructions: m.instructions, source: "ai" }]);
        const existing = (await db().list("meal_plan", { where: [["day", "eq", m.day], ["meal", "eq", m.meal]] }))[0];
        const fields = { day: m.day, meal: m.meal, title: m.name, recipe_id: recipe.id, prep_min: m.prep_min };
        if (existing) await db().update("meal_plan", [["id", "eq", existing.id]], fields);
        else await db().insert("meal_plan", [fields]);
        if (addToList) await addShoppingItems(ingredientsToItems(m.ingredients, recipe.id));
      }
      invalidate("meal_plan", "recipes");
      toast.show(addToList ? "Essensplan und Einkaufsliste aktualisiert" : "Essensplan gespeichert");
      onClose();
    });

  return (
    <Sheet
      title="Woche mit KI planen"
      onClose={onClose}
      wide
      footer={
        result ? (
          <>
            <Button onClick={() => setResult(null)}>Zurück</Button>
            <Button variant="primary" loading={busy === "save"} onClick={accept}>Übernehmen</Button>
          </>
        ) : (
          <Button variant="primary" icon={<Sparkles size={16} />} loading={busy === "plan"} onClick={plan}>Vorschlag erstellen</Button>
        )
      }
    >
      {!result ? (
        <div className="stack">
          <div className="form-grid">
            <Field label="Personen"><input className="input" type="number" inputMode="numeric" min={1} value={persons} onChange={(e) => setPersons(e.target.value)} /></Field>
            <Field label="Ernährung"><input className="input" value={diet} onChange={(e) => setDiet(e.target.value)} placeholder="z. B. vegetarisch, viel Gemüse" /></Field>
            <Field label="Mag ich nicht" className="span-2"><input className="input" value={dislikes} onChange={(e) => setDislikes(e.target.value)} placeholder="z. B. Pilze, Koriander" /></Field>
          </div>
          <Field label="Welche Abende?">
            <div className="weekday-picker">
              {days.map((d) => (
                <button key={d} type="button" className={selected.includes(d) ? "active" : ""} style={{ width: "auto", padding: "0 10px" }} onClick={() => setSelected(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d].sort())}>
                  {formatDayShort(d)}
                </button>
              ))}
            </div>
          </Field>
          {days.length === 0 && <Notice>Diese Woche ist schon vorbei – wechsle zur nächsten Woche.</Notice>}
        </div>
      ) : (
        <div className="stack">
          {result.tips && <Notice>{result.tips}</Notice>}
          {result.meals.map((m) => (
            <div key={`${m.day}-${m.meal}`} className="card flat stack tight">
              <span className="small muted">{formatDayShort(m.day)} · {m.prep_min} Min.</span>
              <span className="strong">{m.name}</span>
              <span className="small muted">{m.ingredients.map((i) => i.name).join(", ")}</span>
            </div>
          ))}
          <Toggle checked={addToList} onChange={setAddToList} label="Zutaten auf die Einkaufsliste setzen" />
        </div>
      )}
    </Sheet>
  );
}
