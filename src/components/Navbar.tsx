"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { LogOut, LayoutDashboard, Clock, Shield } from "lucide-react";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  if (!session) return null;

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex px-2 lg:px-0">
            <div className="flex-shrink-0 flex items-center">
              <Clock className="h-8 w-8 text-blue-600 mr-2" />
              <span className="font-bold text-xl text-gray-900 tracking-tight">Minutas</span>
            </div>
            <div className="hidden lg:ml-8 lg:flex lg:space-x-4">
              <Link
                href="/dashboard"
                className={`${pathname.startsWith("/dashboard")
                    ? "border-blue-500 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
              >
                <LayoutDashboard className="h-4 w-4 mr-1.5" />
                Mi Panel
              </Link>

              {session.user.rol === "ADMIN" && (
                <Link
                  href="/admin"
                  className={`${pathname.startsWith("/admin")
                      ? "border-amber-500 text-gray-900"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <Shield className="h-4 w-4 mr-1.5 text-amber-500" />
                  Administración
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center">
            <div className="flex items-center gap-4">
              <div className="text-sm">
                <p className="text-gray-900 font-medium">{session.user.nombre}</p>
                <p className="text-gray-500 text-xs hidden sm:block">
                  {session.user.email} • <span className={session.user.rol === "ADMIN" ? "text-amber-600 font-semibold" : "text-blue-600"}>{session.user.rol}</span>
                </p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition-colors shadow-sm"
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
