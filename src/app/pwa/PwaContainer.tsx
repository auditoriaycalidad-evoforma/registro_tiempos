"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { signIn, signOut } from "next-auth/react";
import { 
  Clock, Plus, Trash2, Copy, Save, LogOut, Sun, Moon, Calendar, 
  History, PlusCircle, Search, AlertCircle, CheckCircle2, 
  Smartphone, Sparkles, X, ChevronRight, RefreshCw
} from "lucide-react";
import { createMinutasPwa, getPwaHistory, deleteMinutaPwa, PwaInterval } from "@/app/actions/pwa";
import { formatTime24 } from "@/lib/formatTime";

function calculateIntervalHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(start) || !timePattern.test(end)) return 0;
  
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  
  if (endMin <= startMin) return 0;
  return (endMin - startMin) / 60;
}

function formatHistoryTime(timeVal: any): string {
  if (!timeVal) return "";
  if (timeVal instanceof Date) {
    const hours = timeVal.getUTCHours().toString().padStart(2, "0");
    const minutes = timeVal.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  if (typeof timeVal === "string") {
    if (timeVal.includes("T")) {
      const parts = timeVal.split("T");
      if (parts[1]) {
        return parts[1].substring(0, 5);
      }
    }
    if (/^\d{2}:\d{2}$/.test(timeVal)) {
      return timeVal;
    }
    return formatTime24(timeVal);
  }
  return "";
}

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

interface PwaContainerProps {
  proyectos: Proyecto[];
  actividades: Actividad[];
  initialHistory: any[];
  session: any;
}

export function PwaContainer({ proyectos, actividades, initialHistory, session }: PwaContainerProps) {
  // --- STATE ---
  const [activeTab, setActiveTab] = useState<"registrar" | "historial">("registrar");
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [history, setHistory] = useState<any[]>(initialHistory);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // PWA Install state
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(false);

  // Snackbar Notification State
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Form State
  const [fecha, setFecha] = useState<string>(() => {
    const today = new Date();
    // Ajustar por zona horaria local
    const tzOffset = today.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 10);
    return localISOTime;
  });
  const [tipoMinuta, setTipoMinuta] = useState<string>("A"); // "A" = Ordinaria, "B" = Extra
interface PwaIntervalForm {
  proyecto: string;
  proyectoText: string;
  actividad: string;
  actividadText: string;
  horaInicio: string;
  horaFin: string;
  observacion: string;
}

  const [intervals, setIntervals] = useState<PwaIntervalForm[]>([
    { proyecto: "", proyectoText: "", actividad: "", actividadText: "", horaInicio: "", horaFin: "", observacion: "" }
  ]);

  // Autocomplete & focus references
  const [focusedField, setFocusedField] = useState<{ index: number; field: "proyecto" | "actividad" | null }>({ index: -1, field: null });
  const [projectSearch, setProjectSearch] = useState<string[]>([]);
  const [activitySearch, setActivitySearch] = useState<string[]>([]);

  // --- INITIALIZATION ---
  useEffect(() => {
    // Detect dark mode setting or system preference
    const storedTheme = localStorage.getItem("pwa-theme");
    if (storedTheme === "dark" || (!storedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDarkMode(true);
    }

    // Register Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then((reg) => console.log("Service Worker registrado con éxito:", reg.scope))
        .catch((err) => console.error("Error al registrar Service Worker:", err));
    }

    // PWA Install banner event listener
    const handleInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, []);

  // Sync dark class on top container
  const darkClass = darkMode ? "dark" : "";

  const toggleDarkMode = () => {
    const newVal = !darkMode;
    setDarkMode(newVal);
    localStorage.setItem("pwa-theme", newVal ? "dark" : "light");
  };

  // Notification helper
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((prev) => prev?.message === message ? null : prev);
    }, 4500);
  };

  // PWA Install helper
  const handlePwaInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`Instalación PWA: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

  // Refresh user history
  const handleRefreshHistory = async () => {
    setIsRefreshing(true);
    const res = await getPwaHistory();
    setIsRefreshing(false);
    if ("error" in res) {
      showToast("No se pudo actualizar el historial.", "error");
    } else if (res.history) {
      setHistory(res.history);
      showToast("Historial actualizado.", "success");
    }
  };

  // --- AUTOCONVERT SHORT-HAND HOURS ---
  // "8" -> "08:00", "830" -> "08:30", "1745" -> "17:45"
  const formatTimeValue = (val: string): string => {
    const clean = val.replace(/[^0-9]/g, "");
    if (clean.length === 0) return "";
    
    if (clean.length === 1 || clean.length === 2) {
      let hr = parseInt(clean);
      if (hr > 23) hr = 23;
      if (hr < 0) hr = 0;
      return `${hr.toString().padStart(2, "0")}:00`;
    }
    
    if (clean.length === 3) {
      let hr = parseInt(clean.substring(0, 1));
      let min = parseInt(clean.substring(1, 3));
      if (min > 59) min = 59;
      return `${hr.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
    }
    
    if (clean.length >= 4) {
      let hr = parseInt(clean.substring(0, 2));
      let min = parseInt(clean.substring(2, 4));
      if (hr > 23) hr = 23;
      if (min > 59) min = 59;
      return `${hr.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
    }
    
    return val;
  };

  // --- FORM ACTIONS ---
  const updateInterval = (index: number, field: keyof PwaIntervalForm, value: string) => {
    setIntervals((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleTimeBlur = (index: number, field: "horaInicio" | "horaFin", value: string) => {
    const formatted = formatTimeValue(value);
    updateInterval(index, field, formatted);
  };

  const handleQuickHour = (index: number, field: "horaInicio" | "horaFin", option: string) => {
    if (option === "Ahora") {
      const now = new Date();
      const current = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      updateInterval(index, field, current);
    } else {
      updateInterval(index, field, option);
    }
  };

  const handleProjectBlur = (index: number) => {
    setTimeout(() => {
      setIntervals((prev) => {
        const copy = [...prev];
        const typed = copy[index].proyectoText.trim();
        if (!typed) {
          copy[index].proyecto = "";
          copy[index].proyectoText = "";
          return copy;
        }
        const match = proyectos.find(
          (p) => 
            p.code.toLowerCase() === typed.toLowerCase() || 
            p.nombre.toLowerCase() === typed.toLowerCase() ||
            `${p.code} - ${p.nombre}`.toLowerCase() === typed.toLowerCase()
        );
        if (match) {
          copy[index].proyecto = match.code;
          copy[index].proyectoText = `${match.code} - ${match.nombre}`;
        } else {
          const isValidCode = proyectos.some(p => p.code === copy[index].proyecto);
          if (!isValidCode) {
            copy[index].proyecto = "";
          }
        }
        return copy;
      });
      setProjectSearch([]);
    }, 200);
  };

  const handleActivityBlur = (index: number) => {
    setTimeout(() => {
      setIntervals((prev) => {
        const copy = [...prev];
        const typed = copy[index].actividadText.trim();
        if (!typed) {
          copy[index].actividad = "";
          copy[index].actividadText = "";
          return copy;
        }
        const match = actividades.find(
          (a) => 
            a.nombre.toLowerCase() === typed.toLowerCase() || 
            a.code.toLowerCase() === typed.toLowerCase() ||
            `${a.code} - ${a.nombre}`.toLowerCase() === typed.toLowerCase()
        );
        if (match) {
          copy[index].actividad = match.code;
          copy[index].actividadText = match.nombre;
        } else {
          const isValidCode = actividades.some(a => a.code === copy[index].actividad);
          if (!isValidCode) {
            copy[index].actividad = "";
          }
        }
        return copy;
      });
      setActivitySearch([]);
    }, 200);
  };

  const addInterval = () => {
    setIntervals((prev) => [
      ...prev,
      { proyecto: "", proyectoText: "", actividad: "", actividadText: "", horaInicio: "", horaFin: "", observacion: "" }
    ]);
  };

  const duplicateInterval = (index: number) => {
    setIntervals((prev) => {
      const itemToDuplicate = prev[index];
      const copy = [...prev];
      copy.splice(index + 1, 0, { ...itemToDuplicate });
      return copy;
    });
    showToast("Rango duplicado.", "success");
  };

  const removeInterval = (index: number) => {
    if (intervals.length <= 1) {
      showToast("Debe haber al menos un rango de tiempo.", "info");
      return;
    }
    setIntervals((prev) => prev.filter((_, idx) => idx !== index));
    showToast("Rango eliminado.", "info");
  };

  // Quick Date Helpers
  const setQuickDate = (option: "hoy" | "ayer") => {
    const d = new Date();
    if (option === "ayer") {
      d.setDate(d.getDate() - 1);
    }
    const tzOffset = d.getTimezoneOffset() * 60000;
    const localStr = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 10);
    setFecha(localStr);
  };

  // --- DERIVED METRICS / VALIDATION ---

  // Helper: HH:MM -> minutes from midnight
  const timeToMinutes = (t: string): number => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  // Calculate duration per interval
  const calculatedIntervals = useMemo(() => {
    return intervals.map((inv) => {
      if (!inv.horaInicio || !inv.horaFin) return { ...inv, hours: 0, isValid: true };
      
      const startMin = timeToMinutes(inv.horaInicio);
      const endMin = timeToMinutes(inv.horaFin);
      
      const isValid = endMin > startMin;
      const hours = isValid ? (endMin - startMin) / 60 : 0;
      
      return { ...inv, hours, isValid };
    });
  }, [intervals]);

  // Calculate total hours
  const totalHours = useMemo(() => {
    return calculatedIntervals.reduce((acc, curr) => acc + curr.hours, 0);
  }, [calculatedIntervals]);

  // Validate overlaps & missing fields
  const validationResult = useMemo(() => {
    // 1. Check simple constraints
    for (let i = 0; i < intervals.length; i++) {
      const inv = intervals[i];
      if (inv.horaInicio && inv.horaFin) {
        const start = timeToMinutes(inv.horaInicio);
        const end = timeToMinutes(inv.horaFin);
        if (end <= start) {
          return { isValid: false, message: `En rango #${i + 1}: Hora de Fin debe ser posterior a la de Inicio.` };
        }
      }
    }

    // 2. Check internal overlaps
    for (let i = 0; i < intervals.length; i++) {
      const startI = timeToMinutes(intervals[i].horaInicio);
      const endI = timeToMinutes(intervals[i].horaFin);

      if (!intervals[i].horaInicio || !intervals[i].horaFin) continue;

      for (let j = i + 1; j < intervals.length; j++) {
        const startJ = timeToMinutes(intervals[j].horaInicio);
        const endJ = timeToMinutes(intervals[j].horaFin);

        if (!intervals[j].horaInicio || !intervals[j].horaFin) continue;

        if (startI < endJ && startJ < endI) {
          return { 
            isValid: false, 
            message: `Traslape entre Rangos #${i + 1} (${intervals[i].horaInicio}-${intervals[i].horaFin}) y #${j + 1} (${intervals[j].horaInicio}-${intervals[j].horaFin}).` 
          };
        }
      }
    }

    return { isValid: true, message: "" };
  }, [intervals]);

  // --- AUTOCOMPLETES LOGIC ---
  const handleProjectSearch = (text: string, index: number) => {
    updateInterval(index, "proyectoText", text);
    const exactCodeMatch = proyectos.find(p => p.code?.toLowerCase() === text.trim().toLowerCase());
    if (exactCodeMatch) {
      updateInterval(index, "proyecto", exactCodeMatch.code);
    } else {
      updateInterval(index, "proyecto", "");
    }

    if (!text.trim()) {
      setProjectSearch([]);
      return;
    }
    const query = text.toLowerCase();
    const filtered = proyectos
      .filter((p) => p.code?.toLowerCase().includes(query) || p.nombre?.toLowerCase().includes(query))
      .slice(0, 6)
      .map((p) => `${p.code} - ${p.nombre}`);
    setProjectSearch(filtered);
  };

  const handleActivitySearch = (text: string, index: number) => {
    updateInterval(index, "actividadText", text);
    const exactNameMatch = actividades.find(
      (a) => a.nombre?.toLowerCase() === text.trim().toLowerCase() || a.code?.toLowerCase() === text.trim().toLowerCase()
    );
    if (exactNameMatch) {
      updateInterval(index, "actividad", exactNameMatch.code);
    } else {
      updateInterval(index, "actividad", "");
    }

    if (!text.trim()) {
      setActivitySearch([]);
      return;
    }
    const query = text.toLowerCase();
    const filtered = actividades
      .filter((a) => a.nombre?.toLowerCase().includes(query) || a.code?.toLowerCase().includes(query))
      .slice(0, 6)
      .map((a) => `${a.code} - ${a.nombre}`);
    setActivitySearch(filtered);
  };

  // --- SUBMIT ---
  const handleSave = async () => {
    // 1. Resolver búsquedas escritas a códigos
    const resolvedIntervals = intervals.map((inv) => {
      let pCode = inv.proyecto;
      let aCode = inv.actividad;

      if (!pCode && inv.proyectoText.trim()) {
        const pMatch = proyectos.find(
          (p) => 
            p.code?.toLowerCase() === inv.proyectoText.trim().toLowerCase() ||
            p.nombre?.toLowerCase() === inv.proyectoText.trim().toLowerCase() ||
            `${p.code} - ${p.nombre}`.toLowerCase() === inv.proyectoText.trim().toLowerCase()
        );
        if (pMatch) pCode = pMatch.code;
      }

      if (!aCode && inv.actividadText.trim()) {
        const aMatch = actividades.find(
          (a) => 
            a.nombre?.toLowerCase() === inv.actividadText.trim().toLowerCase() ||
            a.code?.toLowerCase() === inv.actividadText.trim().toLowerCase() ||
            `${a.code} - ${a.nombre}`.toLowerCase() === inv.actividadText.trim().toLowerCase()
        );
        if (aMatch) aCode = aMatch.code;
      }

      return {
        ...inv,
        proyecto: pCode,
        actividad: aCode
      };
    });

    // 2. Pre-validar campos
    for (let i = 0; i < resolvedIntervals.length; i++) {
      const inv = resolvedIntervals[i];
      if (!inv.proyecto) {
        showToast(`Rango #${i + 1} requiere un proyecto válido de la lista.`, "error");
        return;
      }
      if (!inv.actividad) {
        showToast(`Rango #${i + 1} requiere una actividad válida de la lista.`, "error");
        return;
      }
      if (!inv.horaInicio || !inv.horaFin) {
        showToast(`Rango #${i + 1} requiere hora de inicio y fin.`, "error");
        return;
      }
    }

    if (!validationResult.isValid) {
      showToast(validationResult.message, "error");
      return;
    }

    setIsLoading(true);
    const dataToSubmit = resolvedIntervals.map((inv) => ({
      proyecto: inv.proyecto,
      actividad: inv.actividad,
      horaInicio: inv.horaInicio,
      horaFin: inv.horaFin,
      observacion: inv.observacion
    }));

    const res = await createMinutasPwa({
      fecha,
      tipo: tipoMinuta,
      intervals: dataToSubmit
    });
    setIsLoading(false);

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast("Tiempos registrados con éxito.", "success");
      // Reset form
      setIntervals([{ proyecto: "", proyectoText: "", actividad: "", actividadText: "", horaInicio: "", horaFin: "", observacion: "" }]);
      // Refresh local history
      const histRes = await getPwaHistory();
      if ("history" in histRes && histRes.history) {
        setHistory(histRes.history);
      }
      // Navigate to History Tab
      setActiveTab("historial");
    }
  };

  // --- DELETE ENTRY ---
  const handleDeleteEntry = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar este registro de tiempo?")) return;

    const res = await deleteMinutaPwa(id);
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast("Registro eliminado.", "success");
      setHistory((prev) => prev.filter((item) => item.id !== id));
    }
  };

  // --- RENDER LOGIN IF NOT LOGGED IN ---
  if (!session) {
    return (
      <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-tr from-slate-100 to-indigo-50 dark:from-slate-900 dark:to-slate-950 ${darkClass}`}>
        <div className="w-full max-w-sm p-8 rounded-3xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-2xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col items-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-brand-primary/10 dark:bg-brand-primary/25 rounded-3xl rotate-12 absolute inset-0 animate-pulse" />
            <div className="w-20 h-20 bg-brand-primary/25 dark:bg-brand-primary/15 rounded-3xl flex items-center justify-center relative">
              <Clock className="w-10 h-10 text-brand-primary" />
            </div>
          </div>
          
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight text-center">
            EVOFORMA TIEMPOS
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 text-center max-w-xs">
            Registro ágil y móvil para personal técnico de campo.
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
              Se requiere una cuenta de correo corporativo para acceder.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER MAIN PWA APP ---
  return (
    <div className={`fixed inset-0 z-40 bg-slate-50 dark:bg-[#0c0d12] text-slate-800 dark:text-slate-100 flex flex-col font-sans select-none overflow-hidden ${darkClass}`}>
      
      {/* 1. TOP BAR */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-[#121318]/80 backdrop-blur-md border-b border-slate-200/50 dark:border-slate-800/50 px-4 py-3 flex items-center justify-between safe-top">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-brand-primary/10 dark:bg-brand-primary/20 flex items-center justify-center">
            <Clock className="w-4 h-4 text-brand-primary" />
          </div>
          <span className="font-black text-lg tracking-tight text-brand-primary">EvoTiempos</span>
          <span className="text-[10px] uppercase font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-md">PWA</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme switcher */}
          <button 
            onClick={toggleDarkMode}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-90 transition-all duration-150"
            title="Cambiar Tema"
          >
            {darkMode ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-indigo-600" />}
          </button>

          {/* Logout */}
          <button 
            onClick={() => {
              if (window.confirm("¿Seguro que deseas cerrar sesión?")) {
                signOut({ callbackUrl: "/pwa" });
              }
            }}
            className="w-10 h-10 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 active:scale-90 transition-all duration-150"
            title="Cerrar Sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 2. PWA INSTALL BANNER */}
      {showInstallBanner && (
        <div className="bg-gradient-to-r from-brand-primary to-orange-600 text-white p-3.5 flex items-center justify-between text-xs font-semibold shadow-inner transition-all animate-fadeIn">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            <span>Instala EvoTiempos en tu pantalla de inicio para acceso offline.</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePwaInstall}
              className="bg-white text-brand-primary px-3 py-1.5 rounded-xl font-bold hover:bg-slate-100 active:scale-95 transition-all shadow-sm"
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

      {/* 3. MAIN WORKSPACE / TAB CONTENT */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        
        {/* === TAB 1: REGISTRAR === */}
        {activeTab === "registrar" && (
          <div className="space-y-5 animate-slideUp">
            
            {/* 3.1 METADATA CARD (Date & Type) */}
            <div className="bg-white dark:bg-[#121318] p-4 rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm space-y-4">
              {/* Date */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
                  Fecha de Registro
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Calendar className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input 
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-brand-primary transition-all font-semibold"
                    />
                  </div>
                  <button 
                    type="button"
                    onClick={() => setQuickDate("hoy")}
                    className={`px-3 py-3 rounded-2xl text-xs font-bold border transition-all ${fecha === new Date().toISOString().slice(0, 10) ? 'bg-brand-primary text-white border-brand-primary' : 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-600 dark:text-slate-300'}`}
                  >
                    Hoy
                  </button>
                  <button 
                    type="button"
                    onClick={() => setQuickDate("ayer")}
                    className="px-3 py-3 rounded-2xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-transparent active:bg-slate-200 dark:active:bg-slate-700 transition-all"
                  >
                    Ayer
                  </button>
                </div>
              </div>

              {/* Segmented Button (Type) */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
                  Tipo de Horas
                </label>
                <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-[#1a1b22] rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setTipoMinuta("A")}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-all ${tipoMinuta === "A" ? "bg-white dark:bg-[#252630] text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                  >
                    Ordinarias (A)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoMinuta("B")}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-all ${tipoMinuta === "B" ? "bg-white dark:bg-[#252630] text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                  >
                    Horas Adicionales (B)
                  </button>
                </div>
              </div>
            </div>

            {/* 3.2 INTERVAL CARDS LIST */}
            <div className="space-y-4">
              {intervals.map((inv, index) => (
                <div 
                  key={index} 
                  className="bg-white dark:bg-[#121318] rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm p-4 relative overflow-visible animate-fadeIn"
                >
                  {/* Card Header (Counter / Actions) */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      Intervalo #{index + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => duplicateInterval(index)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-brand-primary hover:bg-brand-primary/5 active:scale-90 transition-all"
                        title="Duplicar"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeInterval(index)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 active:scale-90 transition-all"
                        title="Eliminar"
                        disabled={intervals.length <= 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    
                    {/* Auto-Complete Proyecto */}
                    <div className="relative">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                        Proyecto (Cédula o Nombre)
                      </label>
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input 
                          type="text"
                          placeholder="Buscar proyecto..."
                          value={inv.proyectoText}
                          onChange={(e) => handleProjectSearch(e.target.value, index)}
                          onFocus={() => setFocusedField({ index, field: "proyecto" })}
                          onBlur={() => handleProjectBlur(index)}
                          className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl pl-9 pr-4 py-2.5 text-xs focus:outline-none focus:border-brand-primary font-medium"
                        />
                      </div>
                      
                      {/* Project Dropdown overlay */}
                      {focusedField.index === index && focusedField.field === "proyecto" && projectSearch.length > 0 && (
                        <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-[#1a1b22] border border-slate-200/50 dark:border-slate-800 rounded-2xl shadow-xl z-20 overflow-hidden animate-scaleIn">
                          {projectSearch.map((option, oIdx) => (
                            <button
                              key={oIdx}
                              type="button"
                              onMouseDown={() => {
                                const code = option.split(" - ")[0];
                                updateInterval(index, "proyecto", code);
                                updateInterval(index, "proyectoText", option);
                                setProjectSearch([]);
                              }}
                              className="w-full text-left px-4 py-3 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 transition-colors border-b border-slate-100 dark:border-slate-800/50 last:border-0 truncate font-semibold"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Auto-Complete Actividad */}
                    <div className="relative">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                        Actividad
                      </label>
                      <div className="relative">
                        <Sparkles className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input 
                          type="text"
                          placeholder="Buscar actividad..."
                          value={inv.actividadText}
                          onChange={(e) => handleActivitySearch(e.target.value, index)}
                          onFocus={() => setFocusedField({ index, field: "actividad" })}
                          onBlur={() => handleActivityBlur(index)}
                          className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl pl-9 pr-4 py-2.5 text-xs focus:outline-none focus:border-brand-primary font-medium"
                        />
                      </div>

                      {/* Activity Dropdown overlay */}
                      {focusedField.index === index && focusedField.field === "actividad" && activitySearch.length > 0 && (
                        <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-20 overflow-hidden animate-scaleIn">
                          {activitySearch.map((option, oIdx) => (
                            <button
                              key={oIdx}
                              type="button"
                              onMouseDown={() => {
                                const code = option.split(" - ")[0];
                                const name = option.substring(code.length + 3);
                                updateInterval(index, "actividad", code);
                                updateInterval(index, "actividadText", name);
                                setActivitySearch([]);
                              }}
                              className="w-full text-left px-4 py-3 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 transition-colors border-b border-slate-100 dark:border-slate-800/50 last:border-0 truncate font-semibold"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Time Pickers (Inicio / Fin) */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Hora Inicio */}
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                          Hora Inicio
                        </label>
                        <input 
                          type="text"
                          placeholder="e.g. 8"
                          value={inv.horaInicio}
                          onChange={(e) => updateInterval(index, "horaInicio", e.target.value)}
                          onBlur={(e) => handleTimeBlur(index, "horaInicio", e.target.value)}
                          className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-2.5 text-xs font-bold text-center focus:outline-none focus:border-brand-primary placeholder:font-normal"
                        />
                        {/* Quick hour chips */}
                        <div className="flex flex-wrap gap-1 mt-1.5 justify-center">
                          {["08:00", "12:00", "13:00", "17:00", "Ahora"].map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleQuickHour(index, "horaInicio", opt)}
                              className="px-1.5 py-0.5 rounded-lg text-[9px] font-bold bg-slate-100 dark:bg-[#1e2029] hover:bg-brand-primary/10 hover:text-brand-primary transition-colors text-slate-500 dark:text-slate-400"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Hora Fin */}
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                          Hora Fin
                        </label>
                        <input 
                          type="text"
                          placeholder="e.g. 17"
                          value={inv.horaFin}
                          onChange={(e) => updateInterval(index, "horaFin", e.target.value)}
                          onBlur={(e) => handleTimeBlur(index, "horaFin", e.target.value)}
                          className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-2.5 text-xs font-bold text-center focus:outline-none focus:border-brand-primary placeholder:font-normal"
                        />
                        {/* Quick hour chips */}
                        <div className="flex flex-wrap gap-1 mt-1.5 justify-center">
                          {["08:00", "12:00", "13:00", "17:00", "Ahora"].map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleQuickHour(index, "horaFin", opt)}
                              className="px-1.5 py-0.5 rounded-lg text-[9px] font-bold bg-slate-100 dark:bg-[#1e2029] hover:bg-brand-primary/10 hover:text-brand-primary transition-colors text-slate-500 dark:text-slate-400"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Observación */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                        Observación
                      </label>
                      <textarea
                        placeholder="Descripción opcional de la tarea..."
                        value={inv.observacion}
                        onChange={(e) => updateInterval(index, "observacion", e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-2 text-xs focus:outline-none focus:border-brand-primary resize-none h-12 font-medium"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Empty space for scrolling */}
            <div className="h-10" />
          </div>
        )}

        {/* === TAB 2: HISTORIAL === */}
        {activeTab === "historial" && (
          <div className="space-y-4 animate-slideUp">
            
            {/* Header / Refresh */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Últimos 50 Registros
              </span>
              <button
                onClick={handleRefreshHistory}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white dark:bg-[#121318] border border-slate-200 dark:border-slate-800 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all text-slate-600 dark:text-slate-300"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>

            {/* List */}
            {history.length === 0 ? (
              <div className="bg-white dark:bg-[#121318] p-8 text-center text-sm text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-800/50 rounded-3xl">
                No hay actividades registradas en tu historial.
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item) => {
                  const startStr = formatHistoryTime(item.hora_inicio);
                  const endStr = formatHistoryTime(item.hora_fin);
                  const duration = calculateIntervalHours(startStr, endStr);

                  const isBType = item.tipo_minuta === "B";

                  return (
                    <div 
                      key={item.id}
                      className="bg-white dark:bg-[#121318] p-4 rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm space-y-3"
                    >
                      {/* Row 1: Date & Type Badge */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{item.fecha}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isBType ? (
                            <>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400">
                                Adicionales (B)
                              </span>
                              {item.aprobado === "PE" && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400">
                                  Pendiente
                                </span>
                              )}
                              {item.aprobado === "SI" && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400">
                                  Aprobado
                                </span>
                              )}
                              {item.aprobado === "RE" && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400">
                                  Rechazado
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary">
                              Ordinario (A)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Hours & Project Info */}
                      <div className="flex items-start justify-between">
                        <div className="space-y-1.5 flex-1 pr-3">
                          <h4 className="text-xs font-bold leading-tight">
                            {item.minuta_proyecto?.nombre || item.proyecto}
                          </h4>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold tracking-wider">
                            PROYECTO: {item.proyecto} • ACTIVIDAD: {item.minuta_actividad?.nombre || item.actividad}
                          </p>
                          {item.observacion && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                              &quot;{item.observacion}&quot;
                            </p>
                          )}
                        </div>

                        {/* Action buttons + Hour count */}
                        <div className="flex flex-col items-end justify-between self-stretch">
                          <span className="text-xs font-black text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-xl">
                            {startStr} - {endStr}
                          </span>
                          
                          {/* Only show delete option if not approved or if type A */}
                          {(!isBType || item.aprobado !== "SI") && (
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(item.id)}
                              className="p-2 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all mt-2"
                              title="Eliminar registro"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* 4. CALCULATION PANEL (Only in Tab: Registrar) */}
      {activeTab === "registrar" && (
        <div className="fixed bottom-16 left-0 right-0 z-20 bg-white/95 dark:bg-[#121318]/95 backdrop-blur-md border-t border-slate-200/50 dark:border-slate-800/50 px-4 py-3.5 flex items-center justify-between shadow-lg select-none">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              Total Horas Rango
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-brand-primary">{totalHours.toFixed(1)}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">horas</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* FAB inside calculation bar for speed and accessibility */}
            <button
              type="button"
              onClick={addInterval}
              className="w-12 h-12 rounded-2xl bg-brand-primary/10 dark:bg-brand-primary/20 text-brand-primary flex items-center justify-center hover:bg-brand-primary/20 active:scale-95 transition-all shadow-sm"
              title="Agregar otro rango"
            >
              <Plus className="w-6 h-6" />
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || totalHours <= 0 || !validationResult.isValid}
              className="px-6 h-12 bg-brand-primary text-white font-bold rounded-2xl shadow-lg shadow-brand-primary/20 hover:bg-brand-primary/95 active:scale-95 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:shadow-none flex items-center gap-2 transition-all"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Guardar</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. BOTTOM NAVIGATION BAR */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-[#121318] border-t border-slate-200/50 dark:border-slate-800/50 grid grid-cols-2 py-1 safe-bottom select-none shadow-xl">
        <button
          type="button"
          onClick={() => setActiveTab("registrar")}
          className={`flex flex-col items-center justify-center py-1.5 transition-all ${activeTab === "registrar" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
        >
          <PlusCircle className={`w-6 h-6 ${activeTab === "registrar" ? "scale-110" : ""} transition-transform`} />
          <span className="text-[10px] font-black uppercase mt-1">Registrar</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("historial")}
          className={`flex flex-col items-center justify-center py-1.5 transition-all ${activeTab === "historial" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
        >
          <History className={`w-6 h-6 ${activeTab === "historial" ? "scale-110" : ""} transition-transform`} />
          <span className="text-[10px] font-black uppercase mt-1">Historial</span>
        </button>
      </nav>

      {/* 6. SNACKBAR NOTIFICATION OVERLAY */}
      {notification && (
        <div className="fixed bottom-28 left-4 right-4 z-50 flex items-center gap-3 p-4 rounded-2xl shadow-2xl border bg-white dark:bg-slate-900 border-slate-200/50 dark:border-slate-800/50 animate-slideUp">
          {notification.type === "success" && (
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
          )}
          {notification.type === "error" && (
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          )}
          {notification.type === "info" && (
            <Clock className="w-5 h-5 text-indigo-500 flex-shrink-0" />
          )}
          
          <span className="text-xs font-bold leading-normal flex-1">
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
