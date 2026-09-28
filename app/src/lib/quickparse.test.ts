import { describe, expect, it } from "vitest";
import { findDateTime, parseQuickText } from "./quickparse";

// 2026-09-28 is a Monday
const TODAY = "2026-09-28";

describe("Schnell erfassen ohne KI", () => {
  it("erkennt Termine mit Wochentag und Uhrzeit", () => {
    const [item] = parseQuickText("Zahnarzt Dienstag 10 Uhr", TODAY);
    expect(item.type).toBe("event");
    expect(item.title).toBe("Zahnarzt");
    expect(item.start).toBe("2026-09-29T10:00");
    expect(item.end).toBe("2026-09-29T11:00");
  });

  it("erkennt relative Tage und Datumsangaben", () => {
    expect(findDateTime("morgen um 14:30 Friseur", TODAY)).toEqual({ date: "2026-09-29", time: "14:30", rest: "Friseur" });
    expect(findDateTime("Elternabend 6.10. 19 Uhr", TODAY).date).toBe("2026-10-06");
    expect(findDateTime("nächsten Montag Yoga", TODAY).date).toBe("2026-10-05");
  });

  it("macht aus Fristen Aufgaben", () => {
    const [item] = parseQuickText("Steuererklärung bis Freitag", TODAY);
    expect(item.type).toBe("task");
    expect(item.due_date).toBe("2026-10-02");
    expect(item.title).toBe("Steuererklärung");
  });

  it("erkennt Einkäufe", () => {
    const items = parseQuickText("Milch, 6 Eier und Brot kaufen", TODAY);
    expect(items.map((i) => [i.type, i.title, i.quantity])).toEqual([
      ["shopping", "Milch", null],
      ["shopping", "Eier", "6"],
      ["shopping", "Brot", null],
    ]);
  });

  it("ordnet Berufliches zu", () => {
    expect(parseQuickText("Präsentation für Kunde vorbereiten", TODAY)[0].area).toBe("beruflich");
  });
});
