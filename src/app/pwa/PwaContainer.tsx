"use client";

import React, { useState, useEffect, useMemo } from "react";
import { signIn, signOut } from "next-auth/react";
import { 
  Trash2, LogOut, Sun, Moon, Calendar, 
  History, CheckCircle2, AlertCircle,
  Smartphone, X, RefreshCw, Play, Check, 
  Wifi, WifiOff, ListFilter, Activity as ActivityIcon, ArrowRight,
  MapPin
} from "lucide-react";
import { getCurrentLocalTime24, addMinutesToTime } from "@/lib/formatTime";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useGeolocation } from "@/lib/useGeolocation";

export interface PwaActiveTask {
  proyecto: string;
  actividad: string;
  horaInicio: string;
  startTimeStamp: number;
  observacion: string;
  fecha: string;
  tipoMinuta: string;
  empleado?: string;
  ubicacion?: string;
}

export interface PwaCompletedTask {
  id: string;
  proyecto: string;
  actividad: string;
  horaInicio: string;
  horaFin: string;
  observacion: string;
  fecha: string;
  tipoMinuta: string;
  empleado?: string;
  ubicacion?: string;
  synced: boolean;
  completedAt: number;
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

interface Empleado {
  id: string;
  apellido_nombre: string;
  cargo?: string | null;
}

interface PwaContainerProps {
  proyectos: Proyecto[];
  actividades: Actividad[];
  empleados?: Empleado[];
  initialHistory: any[];
  session: any;
}

export function PwaContainer({ proyectos, actividades, empleados = [], initialHistory, session }: PwaContainerProps) {
  const allowedAuditorEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session?.user?.email?.toLowerCase();
  const isAdmin = !!(userEmail && allowedAuditorEmails.includes(userEmail));
  const isAuditor = isAdmin;

  // --- STATE ---
  const [activeTab, setActiveTab] = useState<"actividad" | "historial">("actividad");
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [history, setHistory] = useState<any[]>(initialHistory);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // PWA Install state
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(false);

  // Snackbar Notification State
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Global Metadata
  const [selectedEmpleado, setSelectedEmpleado] = useState<string>(session?.user?.id || "");
  const [fecha, setFecha] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  const [tipoMinuta, setTipoMinuta] = useState<string>("P"); // "P" = Habitual, "O" = Extra

  // Selection state for starting/changing activity
  const [selectedProyecto, setSelectedProyecto] = useState<string>("");
  const [selectedActividad, setSelectedActividad] = useState<string>("");
  const [observacionInput, setObservacionInput] = useState<string>("");

  // In-Progress Active Task State (Automated Timer)
  const [activeTask, setActiveTask] = useState<PwaActiveTask | null>(null);

  // Session Log of Completed Activities on this device
  const [completedTasks, setCompletedTasks] = useState<PwaCompletedTask[]>([]);

  // Live timer for elapsed minutes
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0);

  // Geolocalización automática en tiempo real
  const {
    ubicacion,
    loading: geoLoading,
    error: geoError,
    refreshLocation,
  } = useGeolocation();

  // --- PERSISTENCE: INITIAL LOAD & SYNCHRONIZATION ---
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

    // 3. Restore Active Task & Session Log from LocalStorage
    try {
      const savedActiveTask = localStorage.getItem("minuta_pwa_active_task");
      if (savedActiveTask) {
        const parsed = JSON.parse(savedActiveTask);
        if (parsed && parsed.actividad && parsed.horaInicio) {
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          
          // If task is from a previous day, auto-finalize it cleanly
          if (parsed.fecha && parsed.fecha !== todayStr && !isAdmin) {
            autoFinalizeOldTask(parsed);
          } else {
            setActiveTask(parsed);
            if (parsed.tipoMinuta) setTipoMinuta(parsed.tipoMinuta);
            if (parsed.empleado && isAuditor) setSelectedEmpleado(parsed.empleado);
          }
        }
      }

      const savedCompleted = localStorage.getItem("minuta_pwa_completed_tasks");
      if (savedCompleted) {
        const parsedCompleted = JSON.parse(savedCompleted);
        if (Array.isArray(parsedCompleted)) {
          setCompletedTasks(parsedCompleted);
        }
      }
    } catch (e) {
      console.error("Error al restaurar estado de actividad PWA:", e);
    }

    // 4. Initial sync of offline queue
    syncOfflineQueue();

    // 5. Register Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then((reg) => console.log("Service Worker activo:", reg.scope))
        .catch((err) => console.error("Error Service Worker:", err));
    }

    // 6. PWA Install banner prompt listener
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
  }, [isAdmin, isAuditor]);

  // Sync elapsed time ticker
  useEffect(() => {
    if (!activeTask) {
      setElapsedMinutes(0);
      return;
    }

    const calculateElapsed = () => {
      if (!activeTask.startTimeStamp) return 0;
      const diffMs = Math.max(0, Date.now() - activeTask.startTimeStamp);
      return Math.floor(diffMs / 60000);
    };

    setElapsedMinutes(calculateElapsed());
    const interval = setInterval(() => {
      setElapsedMinutes(calculateElapsed());
    }, 30000); // update every 30s

    return () => clearInterval(interval);
  }, [activeTask]);

  // Persist Active Task immediately whenever it changes
  useEffect(() => {
    try {
      if (activeTask) {
        localStorage.setItem("minuta_pwa_active_task", JSON.stringify(activeTask));
      } else {
        localStorage.removeItem("minuta_pwa_active_task");
      }
    } catch (e) {
      console.error("Error al guardar actividad activa en LocalStorage:", e);
    }
  }, [activeTask]);

  // Persist Completed Tasks list
  useEffect(() => {
    try {
      localStorage.setItem("minuta_pwa_completed_tasks", JSON.stringify(completedTasks));
    } catch (e) {
      console.error("Error al guardar actividades completadas:", e);
    }
  }, [completedTasks]);

  // Helper Toast Notification
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Helper Dark Mode
  const toggleDarkMode = () => {
    const newVal = !darkMode;
    setDarkMode(newVal);
    localStorage.setItem("pwa-theme", newVal ? "dark" : "light");
  };

  // Helper PWA Install
  const handlePwaInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`Instalación PWA: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

  // --- REPAIR & RESOLVE CODES ---
  const resolveCodes = (pCodeInput: string, aCodeInput: string) => {
    let pCode = pCodeInput;
    let aCode = aCodeInput;

    if (pCode) {
      const pMatch = proyectos.find(
        (p) =>
          p.code.toLowerCase() === pCode.trim().toLowerCase() ||
          p.nombre.toLowerCase() === pCode.trim().toLowerCase()
      );
      if (pMatch) pCode = pMatch.code;
    }

    if (aCode) {
      const aMatch = actividades.find(
        (a) =>
          a.code.toLowerCase() === aCode.trim().toLowerCase() ||
          a.nombre.toLowerCase() === aCode.trim().toLowerCase()
      );
      if (aMatch) aCode = aMatch.code;
    }

    return { resolvedProject: pCode, resolvedActividad: aCode };
  };

  // --- SAVE RECORD TO SERVER (WITH OFFLINE QUEUE BACKUP) ---
  const dispatchRecordToServer = async (payload: {
    empleado?: string;
    fecha: string;
    tipo: string;
    intervals: {
      proyecto: string;
      actividad: string;
      horaInicio: string;
      horaFin: string;
      observacion: string;
    }[];
  }) => {
    try {
      const response = await fetch("/api/minuta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await response.json();
      if (!response.ok || res.error) {
        throw new Error(res.error || "Error al registrar");
      }

      return { success: true };
    } catch (err: any) {
      // Queue offline
      try {
        const rawQueue = localStorage.getItem("minuta_offline_queue");
        const queue = rawQueue ? JSON.parse(rawQueue) : [];
        queue.push(payload);
        localStorage.setItem("minuta_offline_queue", JSON.stringify(queue));
      } catch (queueErr) {
        console.error("Error guardando en cola offline:", queueErr);
      }
      return { offline: true, error: err.message };
    }
  };

  // --- OFFLINE QUEUE SYNC ---
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
        showToast("¡Actividades guardadas sin conexión sincronizadas con el servidor!", "success");
        // Mark completed tasks as synced
        setCompletedTasks((prev) => prev.map((t) => ({ ...t, synced: true })));
      } else {
        localStorage.setItem("minuta_offline_queue", JSON.stringify(remaining));
      }
    } catch (e) {
      console.error("Error procesando cola offline:", e);
    }
  };

  // Auto finalize an old task from another day
  const autoFinalizeOldTask = async (oldTask: PwaActiveTask) => {
    const safeEnd = addMinutesToTime(oldTask.horaInicio, 30);
    const taskUbicacion = oldTask.ubicacion || ubicacion;
    let formattedObs = oldTask.observacion ? oldTask.observacion.trim() : "";
    if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
      formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
    }

    const completedItem: PwaCompletedTask = {
      id: Math.random().toString(36).substring(2, 9),
      proyecto: oldTask.proyecto,
      actividad: oldTask.actividad,
      horaInicio: oldTask.horaInicio,
      horaFin: safeEnd,
      observacion: oldTask.observacion,
      ubicacion: taskUbicacion,
      fecha: oldTask.fecha,
      tipoMinuta: oldTask.tipoMinuta,
      empleado: oldTask.empleado,
      synced: false,
      completedAt: Date.now(),
    };

    setCompletedTasks((prev) => [completedItem, ...prev]);
    localStorage.removeItem("minuta_pwa_active_task");

    const payload = {
      empleado: isAuditor && oldTask.empleado ? oldTask.empleado : undefined,
      fecha: oldTask.fecha,
      tipo: oldTask.tipoMinuta,
      intervals: [{
        proyecto: oldTask.proyecto,
        actividad: oldTask.actividad,
        horaInicio: oldTask.horaInicio,
        horaFin: safeEnd,
        observacion: formattedObs,
      }],
    };

    await dispatchRecordToServer(payload);
  };

  // --- AUTOMATED ACTIVITY LIFECYCLE HANDLERS ---

  // 1. INICIAR O CAMBIAR ACTIVIDAD
  const handleStartOrChangeActivity = async () => {
    if (!selectedProyecto.trim()) {
      showToast("Seleccione o ingrese un proyecto válido.", "error");
      return;
    }

    if (!selectedActividad.trim()) {
      showToast("Seleccione una actividad de la lista.", "error");
      return;
    }

    const { resolvedProject, resolvedActividad } = resolveCodes(selectedProyecto, selectedActividad);

    // Validate existence
    const projMatch = proyectos.find((p) => p.code === resolvedProject);
    if (!projMatch) {
      showToast("El proyecto seleccionado no es válido en la base de datos.", "error");
      return;
    }

    const actMatch = actividades.find((a) => a.code === resolvedActividad);
    if (!actMatch) {
      showToast("La actividad seleccionada no es válida.", "error");
      return;
    }

    const nowTime = getCurrentLocalTime24();
    const today = new Date();
    const todayLocalStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const effectiveDate = isAdmin ? fecha : todayLocalStr;
    const targetEmp = isAuditor && selectedEmpleado ? selectedEmpleado : session?.user?.id;

    setIsLoading(true);

    // Si ya había una actividad en curso -> FINALIZARLA AUTOMÁTICAMENTE
    if (activeTask) {
      let closeTime = nowTime;
      if (activeTask.horaInicio && closeTime <= activeTask.horaInicio) {
        closeTime = addMinutesToTime(activeTask.horaInicio, 1);
      }

      const taskUbicacion = activeTask.ubicacion || ubicacion;
      let formattedObs = activeTask.observacion ? activeTask.observacion.trim() : "";
      if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
        formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
      }

      const completedItem: PwaCompletedTask = {
        id: Math.random().toString(36).substring(2, 9),
        proyecto: activeTask.proyecto,
        actividad: activeTask.actividad,
        horaInicio: activeTask.horaInicio,
        horaFin: closeTime,
        observacion: activeTask.observacion,
        ubicacion: taskUbicacion,
        fecha: activeTask.fecha,
        tipoMinuta: activeTask.tipoMinuta,
        empleado: activeTask.empleado,
        synced: false,
        completedAt: Date.now(),
      };

      // Add to local completed list
      setCompletedTasks((prev) => [completedItem, ...prev]);

      // Dispatch previous task to backend
      const payload = {
        empleado: isAuditor && activeTask.empleado ? activeTask.empleado : undefined,
        fecha: activeTask.fecha,
        tipo: activeTask.tipoMinuta,
        intervals: [{
          proyecto: activeTask.proyecto,
          actividad: activeTask.actividad,
          horaInicio: activeTask.horaInicio,
          horaFin: closeTime,
          observacion: formattedObs,
        }],
      };

      const result = await dispatchRecordToServer(payload);
      if (result.success) {
        completedItem.synced = true;
      }
    }

    // INICIAR NUEVA ACTIVIDAD CON HORA DE INICIO AUTOMÁTICA
    const newTask: PwaActiveTask = {
      proyecto: resolvedProject,
      actividad: resolvedActividad,
      horaInicio: nowTime,
      startTimeStamp: Date.now(),
      observacion: observacionInput.trim(),
      fecha: effectiveDate,
      tipoMinuta: tipoMinuta,
      empleado: targetEmp,
      ubicacion: ubicacion || undefined,
    };

    setActiveTask(newTask);
    setObservacionInput("");
    setIsLoading(false);

    showToast(
      activeTask
        ? `Actividad anterior finalizada. Iniciada: ${actMatch.nombre}`
        : `Actividad iniciada: ${actMatch.nombre}`,
      "success"
    );
  };

  // 2. FINALIZAR ACTIVIDAD ACTUAL (Cierre explícito sin iniciar otra inmediatamente)
  const handleFinalizeCurrentActivity = async () => {
    if (!activeTask) return;

    const nowTime = getCurrentLocalTime24();
    let closeTime = nowTime;
    if (activeTask.horaInicio && closeTime <= activeTask.horaInicio) {
      closeTime = addMinutesToTime(activeTask.horaInicio, 1);
    }

    setIsLoading(true);

    const taskUbicacion = activeTask.ubicacion || ubicacion;
    let formattedObs = activeTask.observacion ? activeTask.observacion.trim() : "";
    if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
      formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
    }

    const completedItem: PwaCompletedTask = {
      id: Math.random().toString(36).substring(2, 9),
      proyecto: activeTask.proyecto,
      actividad: activeTask.actividad,
      horaInicio: activeTask.horaInicio,
      horaFin: closeTime,
      observacion: activeTask.observacion,
      ubicacion: taskUbicacion,
      fecha: activeTask.fecha,
      tipoMinuta: activeTask.tipoMinuta,
      empleado: activeTask.empleado,
      synced: false,
      completedAt: Date.now(),
    };

    setCompletedTasks((prev) => [completedItem, ...prev]);
    setActiveTask(null);

    const payload = {
      empleado: isAuditor && activeTask.empleado ? activeTask.empleado : undefined,
      fecha: activeTask.fecha,
      tipo: activeTask.tipoMinuta,
      intervals: [{
        proyecto: activeTask.proyecto,
        actividad: activeTask.actividad,
        horaInicio: activeTask.horaInicio,
        horaFin: closeTime,
        observacion: formattedObs,
      }],
    };

    const result = await dispatchRecordToServer(payload);
    setIsLoading(false);

    if (result.success) {
      completedItem.synced = true;
      showToast("Actividad finalizada y guardada exitosamente en el servidor.", "success");
    } else if (result.offline) {
      showToast("Actividad guardada en el dispositivo (se sincronizará al tener conexión).", "info");
    } else {
      showToast(result.error || "Actividad guardada localmente.", "info");
    }
  };

  // 3. ACTUALIZAR OBSERVACIÓN DE LA ACTIVIDAD EN CURSO
  const handleUpdateActiveObservation = (newObs: string) => {
    setActiveTask((prev) => (prev ? { ...prev, observacion: newObs } : null));
  };

  // Refresh user history (Tab 2)
  const handleRefreshHistory = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/minuta").then((r) => r.json());
      setIsRefreshing(false);
      if (res?.error) {
        showToast("No se pudo actualizar el historial.", "error");
      } else if (res?.history) {
        setHistory(res.history);
        showToast("Historial actualizado.", "success");
      }
    } catch {
      setIsRefreshing(false);
      showToast("No se pudo actualizar el historial.", "error");
    }
  };

  // Delete from Admin History
  const handleDeleteHistoryEntry = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar este registro?")) return;

    try {
      const response = await fetch(`/api/minuta/${id}`, { method: "DELETE" });
      const res = await response.json();

      if (!response.ok || res.error) {
        showToast(res.error || "Error al eliminar el registro.", "error");
      } else {
        showToast("Registro eliminado.", "success");
        setHistory((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (err: any) {
      showToast(err?.message || "Error al eliminar el registro.", "error");
    }
  };

  const darkClass = darkMode ? "dark" : "";

  // Helper metadata lookups
  const activeProjectInfo = useMemo(() => {
    if (!activeTask) return null;
    return proyectos.find((p) => p.code === activeTask.proyecto);
  }, [activeTask, proyectos]);

  const activeActividadInfo = useMemo(() => {
    if (!activeTask) return null;
    return actividades.find((a) => a.code === activeTask.actividad);
  }, [activeTask, actividades]);

  // --- RENDER LOGIN IF NOT LOGGED IN ---
  if (!session) {
    return (
      <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-tr from-slate-100 to-indigo-50 dark:from-slate-900 dark:to-slate-950 ${darkClass}`}>
        <div className="w-full max-w-sm p-8 rounded-3xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-2xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col items-center">
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

  // --- RENDER MAIN PWA APP ---
  return (
    <div className={`fixed inset-0 z-40 bg-slate-50 dark:bg-[#0c0d12] text-slate-800 dark:text-slate-100 flex flex-col font-sans select-none overflow-hidden ${darkClass}`}>
      
      {/* 1. TOP HEADER */}
      <header className="sticky top-0 z-30 bg-white/85 dark:bg-[#121318]/85 backdrop-blur-md border-b border-slate-200/50 dark:border-slate-800/50 px-4 py-3 flex items-center justify-between safe-top">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brand-primary/10 dark:bg-brand-primary/20 flex items-center justify-center">
            <ActivityIcon className="w-4 h-4 text-brand-primary" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-black text-base tracking-tight text-brand-primary">EvoMinuta</span>
              <span className="text-[9px] uppercase font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-md">PWA</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection Pill */}
          <div 
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${
              isOnline 
                ? "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 border border-green-200/50 dark:border-green-800/30" 
                : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/30"
            }`}
            title={isOnline ? "Conectado al servidor" : "Modo sin conexión activo"}
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>{isOnline ? "En línea" : "Offline"}</span>
          </div>

          {/* Theme switcher */}
          <button 
            onClick={toggleDarkMode}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-90 transition-all duration-150"
            title="Cambiar Tema"
          >
            {darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
          </button>

          {/* Logout */}
          <button 
            onClick={() => {
              if (window.confirm("¿Seguro que deseas cerrar sesión?")) {
                signOut({ callbackUrl: "/pwa" });
              }
            }}
            className="w-9 h-9 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 active:scale-90 transition-all duration-150"
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

      {/* 3. MAIN WORKSPACE */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        
        {/* === TAB 1: ACTIVIDAD === */}
        {activeTab === "actividad" && (
          <div className="space-y-5 animate-slideUp">
            
            {/* 3.1 METADATA CARD (Colaborador / Fecha / Tipo de Registro) */}
            <div className="bg-white dark:bg-[#121318] p-4 rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm space-y-3.5">
              {/* Colaborador (Solo para auditores) */}
              {isAuditor && empleados.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
                    Apellido - Nombre (Colaborador)
                  </label>
                  <SearchableSelect
                    name="pwa_empleado"
                    value={selectedEmpleado}
                    onChange={(val) => setSelectedEmpleado(val)}
                    options={empleados.map((emp) => ({
                      value: emp.id,
                      label: emp.apellido_nombre,
                      sublabel: emp.cargo ? `(${emp.cargo})` : undefined,
                    }))}
                    placeholder="Seleccione un colaborador"
                    required
                  />
                </div>
              )}

              {/* Fecha (Lectura para técnicos, selector para admin) */}
              {isAdmin && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                    Fecha de Registro
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input 
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-brand-primary transition-all font-semibold"
                    />
                  </div>
                </div>
              )}

              {/* Tipo de Registro (Segmented Buttons) */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
                  Tipo de Registro
                </label>
                <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-[#1a1b22] rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setTipoMinuta("P")}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      tipoMinuta === "P" 
                        ? "bg-white dark:bg-[#252630] text-brand-primary shadow-sm" 
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    Tipo P
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoMinuta("O")}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      tipoMinuta === "O" 
                        ? "bg-white dark:bg-[#252630] text-brand-primary shadow-sm" 
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    Tipo O
                  </button>
                </div>
              </div>

              {/* Ubicación Actual (Geolocalización GPS) */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-brand-primary" />
                    Ubicación Actual (Ciudad - Zona)
                  </label>
                  <button
                    type="button"
                    onClick={() => refreshLocation()}
                    disabled={geoLoading}
                    className="text-[10px] font-bold text-brand-primary hover:text-brand-primary/80 flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-brand-primary/10 active:scale-95 transition-all disabled:opacity-50"
                    title="Actualizar ubicación vía GPS"
                  >
                    <RefreshCw className={`w-3 h-3 ${geoLoading ? "animate-spin" : ""}`} />
                    <span>Actualizar</span>
                  </button>
                </div>

                <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 dark:bg-[#1a1b22] rounded-2xl border border-slate-200/60 dark:border-slate-800/60">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    geoLoading 
                      ? "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 animate-pulse" 
                      : ubicacion 
                        ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" 
                        : "bg-slate-200 dark:bg-slate-700 text-slate-500"
                  }`}>
                    <MapPin className="w-4 h-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {geoLoading ? (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                        Detectando ubicación GPS...
                      </div>
                    ) : ubicacion ? (
                      <div>
                        <span className="text-xs font-black text-slate-900 dark:text-white block truncate">
                          {ubicacion}
                        </span>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold block">
                          ✓ Ubicación capturada
                        </span>
                      </div>
                    ) : geoError ? (
                      <div>
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 block truncate">
                          {geoError}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          Pulsa &quot;Actualizar&quot; para reintentar
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        Ubicación no detectada
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 3.2 CARD DE ACTIVIDAD EN CURSO (AUTOMATED TIMER CARD) */}
            {activeTask ? (
              <div className="relative overflow-hidden rounded-3xl border-2 border-brand-primary/30 bg-gradient-to-br from-white via-orange-50/20 to-white dark:from-[#151720] dark:via-[#1a171f] dark:to-[#121318] p-5 shadow-md animate-fadeIn">
                
                {/* Header Status with Pulsing Indicator */}
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Actividad en Curso
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary">
                      Tipo {activeTask.tipoMinuta}
                    </span>
                    {elapsedMinutes > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {elapsedMinutes}m en curso
                      </span>
                    )}
                  </div>
                </div>

                {/* Project & Activity Info */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Proyecto: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{activeTask.proyecto}</span>
                  </div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white leading-tight">
                    {activeProjectInfo?.nombre || activeTask.proyecto}
                  </h3>
                  
                  <div className="pt-2">
                    <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Actividad
                    </div>
                    <div className="text-sm font-bold text-brand-primary">
                      {activeActividadInfo?.nombre || activeTask.actividad}
                      {activeActividadInfo?.area && (
                        <span className="ml-1.5 text-xs text-slate-400 font-normal">({activeActividadInfo.area})</span>
                      )}
                    </div>
                  </div>

                  {activeTask.ubicacion && (
                    <div className="pt-1">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#1a1b22] border border-slate-200/50 dark:border-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                        <MapPin className="w-3 h-3 text-brand-primary" />
                        {activeTask.ubicacion}
                      </span>
                    </div>
                  )}
                </div>

                {/* Editable Real-Time Note */}
                <div className="mt-4">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                    Observación de la Actividad (Opcional)
                  </label>
                  <textarea
                    placeholder="Notas o descripción de avance..."
                    value={activeTask.observacion}
                    onChange={(e) => handleUpdateActiveObservation(e.target.value)}
                    className="w-full bg-white dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-2 text-xs focus:outline-none focus:border-brand-primary resize-none h-14 font-medium transition-all"
                  />
                </div>

                {/* Finalize Button */}
                <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={handleFinalizeCurrentActivity}
                    disabled={isLoading}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    Finalizar Actividad
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#121318] p-5 rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 dark:bg-brand-primary/20 text-brand-primary flex items-center justify-center mx-auto mb-1">
                  <Play className="w-5 h-5 ml-0.5" />
                </div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">
                  Sin actividad en curso
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                  Selecciona un proyecto y una actividad a continuación para iniciar el registro automático.
                </p>
              </div>
            )}

            {/* 3.3 SELECTOR DE PROYECTO Y ACTIVIDAD (INICIAR O CAMBIAR ACTIVIDAD) */}
            <div className="bg-white dark:bg-[#121318] p-4 rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm space-y-3.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                  <ListFilter className="w-3.5 h-3.5 text-brand-primary" />
                  {activeTask ? "Cambiar a Nueva Actividad" : "Seleccionar Actividad"}
                </span>
                {activeTask && (
                  <span className="text-[10px] font-semibold text-slate-400">
                    Auto-cierra la actual
                  </span>
                )}
              </div>

              {/* Selector Proyecto */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                  Proyecto (Cédula o Nombre)
                </label>
                <SearchableSelect
                  name="pwa_proyecto_select"
                  value={selectedProyecto}
                  onChange={(val) => setSelectedProyecto(val)}
                  options={proyectos.map((p) => ({
                    value: p.code,
                    label: p.code,
                    sublabel: p.nombre,
                  }))}
                  placeholder="Busque o seleccione una cédula de proyecto"
                  required
                />
              </div>

              {/* Selector Actividad */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                  Actividad
                </label>
                <SearchableSelect
                  name="pwa_actividad_select"
                  value={selectedActividad}
                  onChange={(val) => setSelectedActividad(val)}
                  options={actividades.map((a) => ({
                    value: a.code,
                    label: a.nombre,
                    sublabel: a.area ? `(${a.area})` : undefined,
                  }))}
                  placeholder="Busque o seleccione una actividad"
                  required
                />
              </div>

              {/* Observación para nueva actividad */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                  Observación Inicial (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Detalle o descripción de la tarea..."
                  value={observacionInput}
                  onChange={(e) => setObservacionInput(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-2.5 text-xs focus:outline-none focus:border-brand-primary font-medium transition-all"
                />
              </div>

              {/* Action Button: Iniciar / Cambiar Actividad */}
              <button
                type="button"
                onClick={handleStartOrChangeActivity}
                disabled={isLoading || !selectedProyecto.trim() || !selectedActividad.trim()}
                className="w-full py-3.5 px-4 bg-brand-primary text-white font-bold rounded-2xl shadow-lg shadow-brand-primary/20 hover:bg-brand-primary/95 active:scale-95 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:shadow-none flex items-center justify-center gap-2 transition-all mt-2"
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : activeTask ? (
                  <>
                    <ArrowRight className="w-4 h-4" />
                    <span>Iniciar Nueva Actividad (Finaliza la actual)</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Iniciar Actividad</span>
                  </>
                )}
              </button>
            </div>

            {/* Bottom Spacing */}
            <div className="h-6" />
          </div>
        )}

        {/* === TAB 2: HISTORIAL (SOLO ADMINS) === */}
        {activeTab === "historial" && isAdmin && (
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

            {/* History List */}
            {history.length === 0 ? (
              <div className="bg-white dark:bg-[#121318] p-8 text-center text-sm text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-800/50 rounded-3xl">
                No hay actividades registradas en el historial.
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item) => {
                  const isOType = item.tipo_minuta === "O";

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
                          {isOType ? (
                            <>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400">
                                Tipo O
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
                              Tipo {item.tipo_minuta === "A" ? "P" : item.tipo_minuta}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Project & Activity Info */}
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1 pr-3">
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

                        {/* Delete option if allowed */}
                        {(!isOType || item.aprobado !== "SI") && (
                          <button
                            type="button"
                            onClick={() => handleDeleteHistoryEntry(item.id)}
                            className="p-2 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all self-center"
                            title="Eliminar registro"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* 4. BOTTOM NAVIGATION BAR (FOR ADMINS) */}
      {isAdmin && (
        <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-[#121318] border-t border-slate-200/50 dark:border-slate-800/50 grid grid-cols-2 py-1.5 safe-bottom select-none shadow-xl">
          <button
            type="button"
            onClick={() => setActiveTab("actividad")}
            className={`flex flex-col items-center justify-center py-1 transition-all ${
              activeTab === "actividad" 
                ? "text-brand-primary" 
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            <ActivityIcon className={`w-5 h-5 ${activeTab === "actividad" ? "scale-110" : ""} transition-transform`} />
            <span className="text-[10px] font-black uppercase mt-1">Actividad</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("historial")}
            className={`flex flex-col items-center justify-center py-1 transition-all ${
              activeTab === "historial" 
                ? "text-brand-primary" 
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            <History className={`w-5 h-5 ${activeTab === "historial" ? "scale-110" : ""} transition-transform`} />
            <span className="text-[10px] font-black uppercase mt-1">Historial</span>
          </button>
        </nav>
      )}

      {/* 5. SNACKBAR NOTIFICATION OVERLAY */}
      {notification && (
        <div className={`fixed ${isAdmin ? "bottom-20" : "bottom-6"} left-4 right-4 z-50 flex items-center gap-3 p-4 rounded-2xl shadow-2xl border bg-white dark:bg-slate-900 border-slate-200/50 dark:border-slate-800/50 animate-slideUp`}>
          {notification.type === "success" && (
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
          )}
          {notification.type === "error" && (
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          )}
          {notification.type === "info" && (
            <ActivityIcon className="w-5 h-5 text-indigo-500 flex-shrink-0" />
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
