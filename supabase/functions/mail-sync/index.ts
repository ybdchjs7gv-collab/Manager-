// Ruft neue E-Mails aller Postfächer ab (alle 5 Minuten per Zeitplan oder auf Knopfdruck)
// und sortiert sie anschließend im Hintergrund mit der KI.
import { errorMessage, json, readJson, serve } from "../_shared/http.ts";
import { classifyPending, loadAccounts, syncAccount, type SyncReport } from "../_shared/mail.ts";
import { adminClient, isCronRequest, requireUser } from "../_shared/supabase.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

serve(async (req) => {
  const admin = adminClient();
  const started = Date.now();
  const body = await readJson<{ account_id?: string }>(req);

  let userIds: string[];
  if (await isCronRequest(req, admin)) {
    const { data, error } = await admin.from("mail_accounts").select("user_id").eq("enabled", true);
    if (error) throw new Error(error.message);
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  } else {
    userIds = [(await requireUser(req, admin)).id];
  }

  const reports: SyncReport[] = [];
  for (const userId of userIds) {
    for (const account of await loadAccounts(admin, userId, body.account_id)) {
      if (Date.now() - started > 90_000) break;
      reports.push(await syncAccount(admin, account));
    }
  }

  const deadline = started + 330_000;
  const background = (async () => {
    for (const userId of userIds) {
      try {
        const result = await classifyPending(admin, userId, deadline);
        if (result.classified > 0 || result.error) console.log("KI-Sortierung", JSON.stringify(result));
      } catch (err) {
        console.error("KI-Sortierung fehlgeschlagen", errorMessage(err));
      }
    }
  })();
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(background);
  else await background;

  return json({ ok: true, accounts: reports });
});
