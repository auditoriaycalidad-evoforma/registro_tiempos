"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { LogOut, LayoutDashboard, Clock, Shield, FileSpreadsheet } from "lucide-react";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const canApprove = session?.user.rol === "ADMIN" || session?.user.rol === "LIDER";
  const isAdmin = session?.user?.email?.toLowerCase() === "auditoriaycalidad@evoforma.net";

  if (!session) return null;

  return (
    <nav className="bg-third border-b color-white border-brand-light/10 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex px-2 lg:px-0">
            <div className="flex-shrink-0 flex items-center">
              <Clock className="h-8 w-8 text-brand-primary mr-2" />
              <span className="font-bold text-xl text-brand-light tracking-tight">Tiempos</span>
            </div>
            <div className="hidden lg:ml-8 lg:flex lg:space-x-4">
              <Link
                href="/dashboard"
                className={`${pathname.startsWith("/dashboard")
                  ? "border-brand-primary text-brand-light"
                  : "border-transparent text-brand-light/70 hover:border-brand-primary/50 hover:text-brand-dark"
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
              >
                <LayoutDashboard className="h-4 w-4 mr-1.5" />
                Mi Panel
              </Link>

              {canApprove && (
                <Link
                  href="/admin"
                  className={`${pathname.startsWith("/admin")
                    ? "border-brand-accent text-brand-light"
                    : "border-transparent text-brand-light/70 hover:border-brand-accent/50 hover:text-brand-dark"
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <Shield className="h-4 w-4 mr-1.5 text-brand-accent" />
                  Aprobaciones
                </Link>
              )}

              {isAdmin && (
                <Link
                  href="/exportar"
                  className={`${pathname.startsWith("/exportar")
                    ? "border-brand-primary text-brand-light"
                    : "border-transparent text-brand-light/70 hover:border-brand-primary/50 hover:text-brand-dark"
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1.5 text-brand-primary" />
                  Exportar
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center">
            <div className="flex items-center gap-4">
              <div className="text-sm">
                <p className="text-brand-light font-medium">{session.user.name}</p>
                <p className="text-brand-light/70 text-xs hidden sm:block">
                  {session.user.email} • <span className={canApprove ? "text-brand-accent font-semibold" : "text-brand-primary font-semibold"}>{session.user.rol}</span>
                </p>
              </div>
              <button
                onClick={() => {
                  if (window.confirm("¿Estás seguro de que deseas salir?")) {
                    signOut({ callbackUrl: "/login" });
                  }
                }}
                className="inline-flex bg-primary items-center px-3 py-2 border border-transparent bg-brand-transparent text-sm leading-4 font-medium rounded-md text-white b focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-dark transition-colors shadow-sm"
              >
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
