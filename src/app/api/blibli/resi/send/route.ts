// Kirim resi PDF satu paket ke WhatsApp admin secara manual (tombol
// "Kirim Resi" di halaman Pesanan). Perlu sesi admin — tindakan ini
// mengirim pesan WhatsApp atas nama toko.
import { isAuthed } from "@/lib/auth";
import { sendResiForBlibliPackage } from "@/lib/blibli-resi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  let packageId = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      package_id?: string;
    };
    packageId = String(body.package_id ?? "");
  }
  if (!packageId) {
    packageId = new URL(request.url).searchParams.get("package_id") ?? "";
  }
  if (!packageId) {
    return Response.json({ error: "package_id tidak ada" }, { status: 400 });
  }

  try {
    const res = await sendResiForBlibliPackage(packageId);
    // Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
    // generik — balas 200 + pesan supaya alasan aslinya sampai ke browser.
    const status = res.ok ? 200 : process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json(res, { status });
  } catch (e) {
    const result = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, result }, { status });
  }
}
