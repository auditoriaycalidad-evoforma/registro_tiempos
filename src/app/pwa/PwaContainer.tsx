"use client";

import React, { useState, useEffect } from "react";
import { signIn, signOut } from "next-auth/react";
import { 
  LogOut, Sun, Moon, 
  Smartphone, X, RefreshCw, 
  Wifi, WifiOff, Activity as ActivityIcon, Clock, CheckCircle2, AlertCircle
} from "lucide-react";
import { DashboardPanels } from "@/components/DashboardPanels";
import { MinutaForm } from "@/components/MinutaForm";

interface Proyecto {
  code: string;
  nombre: string;
}

interface Actividad {
  code: string;
  nombre: string;
  area: string | null;
  descripcion: string | null;
}

interface Empleado {
  id: string;
  apellido_nombre: string;
  cargo?: string | null;
}

interface PwaContainerProps {
  proyectos: Proyecto[];
  actividades: Actividad[];
  empleados?: Empleado[];
  minutas?: any[];
  session: any;
  isAdmin?: boolean;
  esLiderN?: boolean;
}

export function PwaContainer({ 
  proyectos, 
  actividades, 
  empleados = [], 
  minutas = [], 
  session,
  isAdmin: propIsAdmin,
  esLiderN = false,
}: PwaContainerProps) {
  const allowedAuditorEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session?.user?.email?.toLowerCase()?.trim();
  const isAdmin = propIsAdmin ?? (session?.user?.rol === "ADMIN" || !!(userEmail && allowedAuditorEmails.includes(userEmail)));

  // --- STATE ---
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // PWA Install state
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(false);

  // Toast notification
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // --- PERSISTENCE & OFFLINE SYNCHRONIZATION ---
  useEffect(() => {
    // 1. Connection status
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 2. Dark theme detection
    const storedTheme = localStorage.getItem("pwa-theme");
    if (storedTheme === "dark" || (!storedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDarkMode(true);
    }

    // 3. Initial sync of offline queue
    syncOfflineQueue();

    // 4. Register Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then((reg) => console.log("Service Worker activo:", reg.scope))
        .catch((err) => console.error("Error Service Worker:", err));
    }

    // 5. PWA Install banner prompt listener
    const handleInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Sync offline queue to server
  const syncOfflineQueue = async () => {
    try {
      const rawQueue = localStorage.getItem("minuta_offline_queue");
      if (!rawQueue) return;
      const queue = JSON.parse(rawQueue);
      if (!Array.isArray(queue) || queue.length === 0) return;

      const remaining: any[] = [];
      for (const payload of queue) {
        try {
          const res = await fetch("/api/minuta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) remaining.push(payload);
        } catch {
          remaining.push(payload);
        }
      }

      if (remaining.length === 0) {
        localStorage.removeItem("minuta_offline_queue");
        showToast("¡Actividades guardadas offline sincronizadas con el servidor!", "success");
      } else {
        localStorage.setItem("minuta_offline_queue", JSON.stringify(remaining));
      }
    } catch (e) {
      console.error("Error procesando cola offline:", e);
    }
  };

  // Dark Mode Toggle
  const toggleDarkMode = () => {
    const newVal = !darkMode;
    setDarkMode(newVal);
    localStorage.setItem("pwa-theme", newVal ? "dark" : "light");
  };

  // PWA Install Trigger
  const handlePwaInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setShowInstallBanner(false);
    }
  };

  const darkClass = darkMode ? "dark" : "";

  // --- RENDER LOGIN IF NOT AUTHENTICATED ---
  if (!session) {
    return (
      <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-tr from-slate-100 to-orange-50 dark:from-slate-900 dark:to-slate-950 ${darkClass}`}>
        <div className="w-full max-w-sm p-8 rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-2xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col items-center animate-fadeIn">
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-brand-primary/10 dark:bg-brand-primary/25 rounded-3xl rotate-12 absolute inset-0 animate-pulse" />
            <div className="w-20 h-20 bg-brand-primary/25 dark:bg-brand-primary/15 rounded-3xl flex items-center justify-center relative">
              <ActivityIcon className="w-10 h-10 text-brand-primary" />
            </div>
          </div>
          
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight text-center">
            EVOFORMA ACTIVIDADES
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 text-center max-w-xs">
            Registro ágil y móvil de actividades en campo.
          </p>

          <div className="w-full mt-8 space-y-4">
            <button
              onClick={() => signIn("google", { callbackUrl: "/pwa" })}
              className="w-full flex items-center justify-center gap-3 py-4 px-5 rounded-2xl bg-brand-primary hover:bg-brand-primary/95 text-white font-semibold shadow-lg shadow-brand-primary/20 active:scale-95 transition-all duration-150"
            >
              <Smartphone className="w-5 h-5" />
              Ingresar con Google
            </button>
            
            <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-2">
              Se requiere una cuenta corporativa autorizada para acceder.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER MAIN PWA WORKSPACE ---
  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-[#0c0d12] text-slate-800 dark:text-slate-100 flex flex-col font-sans ${darkClass}`}>
      
      {/* 1. TOP PWA HEADER */}
      <header className="sticky top-0 z-40 bg-white/90 dark:bg-[#121318]/90 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 px-4 py-3 flex items-center justify-between safe-top shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand-primary/10 dark:bg-brand-primary/20 flex items-center justify-center">
            <ActivityIcon className="w-5 h-5 text-brand-primary" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-black text-base tracking-tight text-brand-primary">EvoMinuta</span>
              {isAdmin ? (
                <span className="text-[9px] uppercase font-extrabold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400 px-1.5 py-0.5 rounded-md">
                  Administración
                </span>
              ) : (
                <span className="text-[9px] uppercase font-extrabold bg-brand-primary/10 text-brand-primary px-1.5 py-0.5 rounded-md">
                  Colaborador
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[160px] sm:max-w-xs font-medium">
              {session.user.name || session.user.email}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection Status Pill */}
          <div 
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full transition-all ${
              isOnline 
                ? "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 border border-green-200/50 dark:border-green-800/30" 
                : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/30 animate-pulse"
            }`}
            title={isOnline ? "Conectado al servidor" : "Modo sin conexión activo"}
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span className="hidden sm:inline">{isOnline ? "En línea" : "Offline"}</span>
          </div>

          {/* Theme switcher */}
          <button 
            onClick={toggleDarkMode}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-90 transition-all duration-150 border border-slate-200/40 dark:border-slate-800/40"
            title="Cambiar Tema"
          >
            {darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-brand-dark" />}
          </button>

          {/* Logout */}
          <button 
            onClick={() => {
              if (window.confirm("¿Seguro que deseas cerrar sesión?")) {
                signOut({ callbackUrl: "/pwa" });
              }
            }}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 active:scale-90 transition-all duration-150 border border-red-100 dark:border-red-950/40"
            title="Cerrar Sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. PWA INSTALL BANNER */}
      {showInstallBanner && (
        <div className="bg-gradient-to-r from-brand-primary to-orange-600 text-white p-3 flex items-center justify-between text-xs font-semibold shadow-inner transition-all animate-fadeIn">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 flex-shrink-0" />
            <span>Instala esta aplicación en tu pantalla de inicio para acceso rápido.</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            <button 
              onClick={handlePwaInstall}
              className="bg-white text-brand-primary px-3 py-1 rounded-xl font-bold hover:bg-slate-100 active:scale-95 transition-all shadow-sm"
            >
              Instalar
            </button>
            <button 
              onClick={() => setShowInstallBanner(false)}
              className="p-1 text-white/80 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 3. MAIN WORKSPACE (IDENTICAL TO DASHBOARD) */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-6 pb-20 space-y-8 animate-fadeIn">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Mi Panel</h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {isAdmin ? "Gestión de registros e historial general." : "Registra tu actividad."}
            </p>
          </div>
        </div>

        {isAdmin ? (
          <DashboardPanels
            proyectos={proyectos}
            actividades={actividades}
            empleados={empleados}
            defaultEmpleadoId={session.user.id}
            minutas={minutas}
          />
        ) : esLiderN ? (
          <div className="max-w-3xl mx-auto w-full">
            <MinutaForm 
              proyectos={proyectos} 
              actividades={actividades} 
              canSelectEmpleado={false}
              isAdmin={false}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(30rem,0.95fr)_minmax(0,1.25fr)] gap-6 2xl:gap-8">
            <div className="w-full">
              <MinutaForm 
                proyectos={proyectos} 
                actividades={actividades} 
                canSelectEmpleado={false}
                isAdmin={false}
              />
            </div>

            <div className="min-w-0">
              <div className="bg-white dark:bg-[#121318] rounded-xl shadow-md border border-brand-dark/10 dark:border-slate-800 p-8 text-center text-brand-dark/60 dark:text-slate-400 h-full min-h-[300px] flex flex-col justify-center items-center">
                <Clock className="w-12 h-12 text-brand-primary/45 mb-4 animate-pulse" />
                <h3 className="text-lg font-bold text-brand-dark dark:text-white mb-1">Historial Privado</h3>
                <p className="text-sm max-w-sm">El historial de registros es restringido y únicamente visible para la administración.</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 4. SNACKBAR NOTIFICATION OVERLAY */}
      {notification && (
        <div className="fixed bottom-6 left-4 right-4 max-w-md mx-auto z-50 flex items-center gap-3 p-4 rounded-2xl shadow-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 animate-slideUp">
          {notification.type === "success" && (
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
          )}
          {notification.type === "error" && (
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          )}
          {notification.type === "info" && (
            <ActivityIcon className="w-5 h-5 text-brand-primary flex-shrink-0" />
          )}
          
          <span className="text-xs font-bold leading-normal flex-1 text-slate-800 dark:text-slate-200">
            {notification.message}
          </span>
          
          <button 
            onClick={() => setNotification(null)}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

    </div>
  );
}
