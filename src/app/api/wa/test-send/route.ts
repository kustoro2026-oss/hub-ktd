// Kirim uji: kirim satu pesan template (dengan nilai variabel) ke nomor
// tujuan — default nomor admin (OWNER_WA_NUMBER / nomor CS toko) — supaya
// hasil template bisa dilihat langsung sebelum kampanye besar dimulai.
//
// Hanya template berstatus APPROVED yang boleh dikirim; kegagalan Meta
// dikembalikan sebagai 200 {ok:false, detail} supaya bisa ditampilkan
// inline di form (konvensi graceful-error project ini).
import { isAuthed } from "@/lib/auth";
import {
  getTemplateStatus,
  normalizePhone,
  ownerNumber,
  sendTemplate,
  sendTemplateParams,
} from "@/lib/wa";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: {
    template?: string;
    lang?: string;
    vars?: string[];
    phone?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const template = body.template?.trim();
  if (!template) {
    return Response.json({ error: "Nama template wajib diisi" }, { status: 400 });
  }
  const tplStatus = await getTemplateStatus(template);
  if (tplStatus && tplStatus !== "APPROVED") {
    return Response.json({
      ok: false,
      detail: `Template "${template}" masih berstatus ${tplStatus} di Meta — tunggu sampai disetujui sebelum uji kirim.`,
    });
  }

  const target = normalizePhone(body.phone ?? "") ?? ownerNumber();
  if (!target) {
    return Response.json({
      ok: false,
      detail: "Nomor tujuan tidak valid — periksa nomornya",
    });
  }

  const vars = (body.vars ?? []).map((v) => v.trim());
  const res =
    vars.length > 0
      ? await sendTemplateParams(target, template, vars, (body.lang ?? "id").trim() || "id")
      : await sendTemplate(target, template);
  if (!res.ok) {
    return Response.json({ ok: false, detail: res.error ?? "Gagal mengirim" });
  }
  return Response.json({
    ok: true,
    to: target,
    detail: "Pesan uji terkirim — cek HP Anda",
  });
}
