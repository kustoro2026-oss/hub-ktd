// Halaman berhenti berlangganan (publik) — link di footer tiap email.
// Token = HMAC alamat email dengan secret aplikasi; tanpa token yang
// cocok, alamat tidak diubah. Menampilkan halaman HTML sederhana berbahasa
// Indonesia (bukan JSON) supaya nyaman dibuka dari email.
import { getEmailContactByEmail, setEmailContactStatus } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/email-smtp";

function page(title: string, message: string): Response {
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;text-align:center;">
<h1 style="font-size:18px;margin:0 0 12px;color:#0f172a;">${title}</h1>
<p style="font-size:14px;color:#475569;line-height:1.6;margin:0;">${message}</p>
</div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get("email") ?? "").trim().toLowerCase();
  const token = searchParams.get("token") ?? "";
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return page(
      "Link tidak valid",
      "Link berhenti berlangganan ini tidak valid. Silakan salin link utuh dari email yang kamu terima.",
    );
  }
  const contact = await getEmailContactByEmail(email);
  if (!contact) {
    return page(
      "Sudah berhenti",
      "Alamat ini tidak ada di daftar email KTD Store — mungkin sudah dihapus sebelumnya.",
    );
  }
  await setEmailContactStatus(contact.id, "unsubscribed");
  return page(
    "Berhasil berhenti berlangganan",
    `Alamat <strong>${email}</strong> sudah dihapus dari daftar email KTD Store. Kamu tidak akan menerima email promo lagi. Terima kasih!`,
  );
}
