// Integrationstest gegen einen echten IMAP-Server (z. B. lokales Dovecot).
// Läuft nur mit gesetzten Umgebungsvariablen:
//   IMAP_TEST_HOST, IMAP_TEST_PORT, IMAP_TEST_USER, IMAP_TEST_PASS
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  appendMessage,
  changeFlags,
  detectFolders,
  fetchFlags,
  fetchNewMessages,
  type ImapAccount,
  moveMessages,
  withImap,
} from "./imap.ts";

const host = Deno.env.get("IMAP_TEST_HOST");

const account: ImapAccount = {
  imap_host: host ?? "",
  imap_port: Number(Deno.env.get("IMAP_TEST_PORT") ?? 993),
  imap_secure: true,
  username: Deno.env.get("IMAP_TEST_USER") ?? "",
  folder: "INBOX",
};
const password = Deno.env.get("IMAP_TEST_PASS") ?? "";

function mail(n: number, extraHeaders: string[] = []): Uint8Array {
  const headers = [
    `From: "Absender ${n}" <person${n}@example.org>`,
    "To: test@example.com",
    `Subject: =?UTF-8?Q?Testmail_${n}_=E2=80=93_Gr=C3=BC=C3=9Fe?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <test-${n}-${crypto.randomUUID()}@example.org>`,
    ...extraHeaders,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
  ];
  const body = `<p>Hallo, das ist Nachricht <b>${n}</b>.</p>`;
  return new TextEncoder().encode(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`);
}

Deno.test({
  name: "IMAP: abrufen, Flags, Verschieben",
  ignore: !host,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withImap(account, password, async (client) => {
      const folders = await detectFolders(client);
      assert(folders.trash, "Papierkorb nicht erkannt");
      assert(folders.sent, "Gesendet nicht erkannt");

      // Start from an empty inbox
      const lock = await client.getMailboxLock("INBOX");
      try {
        if ((client.mailbox && client.mailbox.exists) || 0) await client.messageDelete("1:*");
      } finally {
        lock.release();
      }

      await appendMessage(client, "INBOX", mail(1), []);
      await appendMessage(
        client,
        "INBOX",
        mail(2, [
          "List-Unsubscribe: <https://news.example/u>",
          "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
        ]),
        ["\\Seen"],
      );

      const first = await fetchNewMessages(client, "INBOX", { uidValidity: null, lastUid: 0 }, {
        batch: 1,
        sinceDays: 14,
        initialMax: 60,
      });
      assertEquals(first.messages.length, 1);
      assertEquals(first.remaining, 1);
      assert(first.reset);
      assertEquals(first.messages[0].subject, "Testmail 1 – Grüße");
      assertEquals(first.messages[0].bodyText, "Hallo, das ist Nachricht 1.");
      assertEquals(first.messages[0].isBulk, false);

      const second = await fetchNewMessages(client, "INBOX", { uidValidity: first.uidValidity, lastUid: first.lastUid }, {
        batch: 10,
        sinceDays: 14,
        initialMax: 60,
      });
      assertEquals(second.messages.length, 1);
      assert(second.messages[0].isBulk);
      assert(second.messages[0].unsubscribeOneClick);
      assert(second.messages[0].seen);

      const none = await fetchNewMessages(client, "INBOX", { uidValidity: second.uidValidity, lastUid: second.lastUid }, {
        batch: 10,
        sinceDays: 14,
        initialMax: 60,
      });
      assertEquals(none.messages.length, 0);
      assertEquals(none.lastUid, second.lastUid);

      const uid1 = first.messages[0].uid;
      const uid2 = second.messages[0].uid;
      await changeFlags(client, "INBOX", [uid1], ["\\Seen"], true);
      let flags = await fetchFlags(client, "INBOX", [uid1, uid2]);
      assert(flags.get(uid1)?.has("\\Seen"));

      await moveMessages(client, "INBOX", [uid2], folders.trash!);
      flags = await fetchFlags(client, "INBOX", [uid1, uid2]);
      assert(flags.has(uid1));
      assert(!flags.has(uid2), "verschobene Mail noch im Posteingang");
    });
  },
});
