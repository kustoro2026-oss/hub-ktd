// Konsol API Digiflazz — panggil 8 endpoint Buyer API dari KTD Hub.
// Seluruh eksekusi diteruskan ke route admin toko (POST /api/topup/digiflazz)
// lewat proxy hub; penandatanganan md5 dan relay IP whitelist tetap di toko.
import DigiflazzConsole from "@/components/digiflazz-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · API Digiflazz" };

export default function TopupApiDigiflazzPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Top Up · API Digiflazz
        </p>
        <h1 className="text-xl font-bold text-slate-900">Konsol API Digiflazz</h1>
        <p className="text-sm text-slate-500">
          Panggil endpoint Buyer API Digiflazz lewat relay toko — hasil respons
          JSON ditampilkan langsung per endpoint.
        </p>
      </div>
      <DigiflazzConsole />
    </div>
  );
}
