import LoginForm from "@/components/login-form";

export const metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-bold text-slate-900">KTD Hub</h1>
        <p className="mb-6 text-sm text-slate-500">
          Dashboard operasional KTD Store
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
