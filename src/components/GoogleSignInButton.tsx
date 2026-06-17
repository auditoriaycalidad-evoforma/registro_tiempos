"use client";

import { signIn } from "next-auth/react";
import { LogIn } from "lucide-react";

export function GoogleSignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
      className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-brand-primary hover:bg-brand-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary transition-colors shadow-md"
    >
      <span className="absolute left-0 inset-y-0 flex items-center pl-3">
        <LogIn className="h-5 w-5 text-white/70 group-hover:text-white" aria-hidden="true" />
      </span>
      Iniciar sesion con Google
    </button>
  );
}
