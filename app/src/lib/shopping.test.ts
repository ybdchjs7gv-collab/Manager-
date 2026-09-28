import { describe, expect, it } from "vitest";
import { guessCategory, mergeQuantities, splitItems, splitQuantity } from "./shopping";

describe("Einkaufsliste", () => {
  it("errät Kategorien", () => {
    expect(guessCategory("Bananen")).toBe("Obst & Gemüse");
    expect(guessCategory("Vollkornbrot")).toBe("Brot & Backwaren");
    expect(guessCategory("Hafermilch")).toBe("Milch & Kühlregal");
    expect(guessCategory("Spülmittel")).toBe("Haushalt");
    expect(guessCategory("Eier")).toBe("Milch & Kühlregal");
    expect(guessCategory("Geschenkpapier")).toBe("Sonstiges");
  });

  it("trennt Mengenangaben", () => {
    expect(splitQuantity("2 l Milch")).toEqual({ name: "Milch", quantity: "2 l" });
    expect(splitQuantity("500 g Hackfleisch")).toEqual({ name: "Hackfleisch", quantity: "500 g" });
    expect(splitQuantity("Tomaten 6 stk")).toEqual({ name: "Tomaten", quantity: "6 stk" });
    expect(splitQuantity("brot")).toEqual({ name: "Brot", quantity: null });
  });

  it("zerlegt Aufzählungen", () => {
    expect(splitItems("Milch, 6 Eier und Brot").map((i) => i.name)).toEqual(["Milch", "Eier", "Brot"]);
  });

  it("fasst Mengen zusammen", () => {
    expect(mergeQuantities("200 g", "300 g")).toBe("500 g");
    expect(mergeQuantities("1 Dose", "2 Stk")).toBe("1 Dose + 2 Stk");
    expect(mergeQuantities(null, "2")).toBe("2");
  });
});
