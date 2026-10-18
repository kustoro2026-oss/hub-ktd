// Konsol API Digiflazz — panggil 8 endpoint Buyer API dari KTD Hub.
// Seluruh eksekusi diteruskan ke route admin toko (POST /api/topup/digiflazz)
// lewat proxy hub; penandatanganan md5 dan relay IP whitelist tetap di toko.
import DigiflazzConsole from "@/components/digiflazz-console";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · API Digiflazz" };

export default function TopupApiDigiflazzPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Top Up · API Digiflazz"
        title="Konsol API Digiflazz"
        subtitle="Panggil endpoint Buyer API Digiflazz lewat relay toko"
      />
      <DigiflazzConsole />
    </div>
  );
}
