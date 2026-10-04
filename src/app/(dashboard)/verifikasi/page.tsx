// Halaman Verifikasi WhatsApp — cek nomor kontak terdaftar di WhatsApp
// atau tidak sebelum dipakai broadcast massal (endpoint contacts Meta,
// gratis, tidak memakai kuota pesan).
import { listContacts } from "@/lib/db";
import VerifikasiClient from "@/components/verifikasi-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verifikasi WhatsApp" };

export default async function VerifikasiPage() {
  const contacts = await listContacts();
  return <VerifikasiClient contacts={contacts} />;
}
