import { AlertCircle, Clock } from "lucide-react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { CredentialsSignInForm } from "@/components/CredentialsSignInForm";

type LoginPageProps = {
  searchParams?: {
    error?: string;
  };
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  const authError = searchParams?.error;

  const getErrorMessage = () => {
    if (!authError) return "";
    if (authError === "AccessDenied") {
      return "Tu cuenta no está registrada o está inactiva en el sistema.";
    }
    if (authError === "CredentialsSignin") {
      return "Usuario o contraseña incorrectos.";
    }
    return "No fue posible iniciar sesion. Intentalo de nuevo.";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-dark/5 to-brand-primary/10 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-2xl shadow-xl border border-brand-dark/10">
        <div>
          <div className="flex justify-center">
            <div className="h-16 w-16 bg-brand-primary/20 rounded-full flex items-center justify-center">
              <Clock className="h-8 w-8 text-brand-primary" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-brand-dark tracking-tight">
            TIME TRACKING SYSTEM
          </h2>
          <p className="mt-2 text-center text-sm text-brand-dark/70">
            Ingresa al sistema de registro de actividades
          </p>
        </div>

        <div className="mt-8 space-y-6">
          {authError && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2 flex-shrink-0" />
              <p className="text-sm text-red-700">{getErrorMessage()}</p>
            </div>
          )}

          <GoogleSignInButton />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-brand-dark/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-brand-dark/50">o</span>
            </div>
          </div>

          <CredentialsSignInForm />
        </div>
      </div>
    </div>
  );
}
