// Supabase Edge Function: send-notification-email
// Versie: 0.8.6
//
// Wordt aangeroepen door een Database Webhook bij elke INSERT in email_notifications.
// Verstuurt een email via SendGrid en zet sent=true in de database.
//
// Deploy:
//   supabase functions deploy send-notification-email
//   supabase secrets set SENDGRID_API_KEY='SG.xxx...'
//
// Webhook instellen in Supabase Dashboard:
//   Database → Webhooks → Create webhook
//   Table: email_notifications, Event: INSERT
//   URL: https://<project-ref>.supabase.co/functions/v1/send-notification-email

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SENDGRID_API_KEY     = Deno.env.get("SENDGRID_API_KEY")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OWNER_EMAIL          = "eddyverbruggen@gmail.com";

interface WebhookPayload {
  type: "INSERT";
  table: string;
  record: EmailNotification;
}

interface EmailNotification {
  id: string;
  reaction_type: "comment" | "emoji";
  reactor_name?: string;
  reactor_email?: string;
  emoji?: string;
  comment_text?: string;
  property_address?: string;
  property_url?: string;
  sent: boolean;
}

function buildHtml(n: EmailNotification): string {
  const name    = n.reactor_name || "Anoniem";
  const address = n.property_address || "een woning";
  const url     = n.property_url || "https://www.funda.nl";

  const reaction = n.reaction_type === "comment"
    ? `<blockquote style="background:#f5f5f5;padding:12px 16px;border-left:4px solid #e86c2a;margin:16px 0;border-radius:4px;font-style:italic;">
         ${n.comment_text}
         <footer style="margin-top:8px;font-style:normal;font-weight:600;">— ${name}</footer>
       </blockquote>`
    : `<p style="font-size:48px;margin:16px 0;">${n.emoji}</p>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#e86c2a;border-bottom:2px solid #e86c2a;padding-bottom:8px">Funda Inzicht</h2>
      <p>Hallo Eddy,</p>
      <p>Er is een nieuwe reactie op <strong>${address}</strong>:</p>
      ${reaction}
      <p><a href="${url}" style="display:inline-block;background:#e86c2a;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Bekijk op Funda &rarr;</a></p>
      <p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">
        Monitor-notificatie van Funda Inzicht
      </p>
    </body></html>`;
}

async function sendEmail(n: EmailNotification) {
  const subject = n.reaction_type === "comment"
    ? `Nieuwe reactie op: ${n.property_address || "een woning"}`
    : `Nieuwe emoji op: ${n.property_address || "een woning"}`;

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: OWNER_EMAIL }], subject }],
      from: { email: "eddyverbruggen@gmail.com", name: "Funda Inzicht" },
      content: [{ type: "text/html", value: buildHtml(n) }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SendGrid ${res.status}: ${err}`);
  }
}

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const n = payload.record;

    // Sla over als al verzonden (dubbele webhook)
    if (n.sent) {
      return new Response(JSON.stringify({ skipped: "already sent" }), { status: 200 });
    }

    await sendEmail(n);

    // Zet sent=true via service role (omzeilt RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase
      .from("email_notifications")
      .update({ sent: true, sent_at: new Date().toISOString() })
      .eq("id", n.id);

    console.log(`Email verstuurd voor notificatie ${n.id}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });

  } catch (err) {
    console.error("Fout:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
