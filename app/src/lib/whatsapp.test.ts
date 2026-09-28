import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { chatNameFromFile, messageHash, parseChatText, readChatFile } from "./whatsapp";

const IOS = `[27.09.26, 18:01:12] Anna Müller: ‎Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt. Niemand außerhalb dieses Chats kann sie lesen.
[27.09.26, 18:02:40] Anna Müller: Hast du am Samstag Zeit?
Wir könnten um 15 Uhr ins Café.
[27.09.26, 18:05:01] Lisa: Ja, gern!
‎[27.09.26, 18:06:00] Anna Müller: ‎Bild weggelassen
[27.09.26, 18:07:00] Anna Müller: Diese Nachricht wurde gelöscht.`;

const ANDROID = `27.09.26, 18:01 - Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt. Tippe, um mehr zu erfahren.
27.09.26, 18:02 - Team Büro: Meeting morgen 9:30 im Raum 2
27.09.26, 18:03 - Max: <Medien ausgeschlossen>
27.09.26, 18:04 - Max: Bringe die Unterlagen mit`;

const US = `9/28/26, 2:03 PM - Sam: See you at 7?
9/28/26, 2:05 PM - Me: Sure`;

describe("WhatsApp-Export lesen", () => {
  it("liest iPhone-Exporte mit mehrzeiligen Nachrichten", () => {
    const chat = parseChatText(IOS, "WhatsApp Chat - Anna Müller.zip");
    expect(chat.name).toBe("Anna Müller");
    expect(chat.messages.map((m) => m.text)).toEqual([
      "Hast du am Samstag Zeit?\nWir könnten um 15 Uhr ins Café.",
      "Ja, gern!",
      "[Bild]",
    ]);
    expect(chat.messages[0].sentAt).toEqual(new Date(2026, 8, 27, 18, 2, 40));
    expect(chat.participants).toEqual(["Anna Müller", "Lisa"]);
  });

  it("liest Android-Exporte und überspringt Systemzeilen", () => {
    const chat = parseChatText(ANDROID, "WhatsApp Chat mit Team Büro.txt");
    expect(chat.name).toBe("Team Büro");
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[1].text).toBe("[Medien]");
    expect(chat.messages[0].sentAt).toEqual(new Date(2026, 8, 27, 18, 2));
  });

  it("erkennt US-Datumsformat mit AM/PM", () => {
    const chat = parseChatText(US);
    expect(chat.messages[0].sentAt).toEqual(new Date(2026, 8, 28, 14, 3));
  });

  it("ermittelt den Chatnamen aus Dateinamen", () => {
    expect(chatNameFromFile("WhatsApp-Chat mit Mama.txt")).toBe("Mama");
    expect(chatNameFromFile("_chat.txt")).toBeNull();
  });

  it("entpackt ZIP-Dateien", async () => {
    const zip = zipSync({ "_chat.txt": strToU8(IOS) });
    const file = new File([zip], "WhatsApp Chat - Anna Müller.zip");
    const chat = await readChatFile(file);
    expect(chat.messages).toHaveLength(3);
  });

  it("erzeugt stabile Prüfsummen", async () => {
    const m = { sentAt: new Date(2026, 8, 27, 18, 2, 40), author: "Anna", text: "Hallo" };
    expect(await messageHash(m)).toBe(await messageHash({ ...m }));
    expect(await messageHash(m)).not.toBe(await messageHash({ ...m, text: "Hallo!" }));
  });
});
