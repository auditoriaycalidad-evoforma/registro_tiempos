"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  Plus, Calendar, AlertCircle, User, Lock, Play, 
  Check, ArrowRight, CheckCircle2, Activity as ActivityIcon, RefreshCw, MapPin 
} from "lucide-react";
import { useSession } from "next-auth/react";
import { SearchableSelect } from "./SearchableSelect";
import { getCurrentLocalTime24, addMinutesToTime } from "@/lib/formatTime";
import { useGeolocation } from "@/lib/useGeolocation";

interface EmpleadoOption {
  id: string;
  apellido_nombre: string;
  cargo?: string | null;
}

interface ProyectoOption {
  code: string;
  nombre: string;
}

interface ActividadOption {
  code: string;
  nombre: string;
  area: string | null;
  descripcion: string | null;
}

export interface DesktopActiveTask {
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

export interface DesktopCompletedTask {
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

export function MinutaForm({ 
  proyectos, 
  actividades,
  empleados = [],
  canSelectEmpleado = false,
  defaultEmpleadoId = "",
  isAdmin: propIsAdmin,
}: { 
  proyectos: ProyectoOption[]; 
  actividades: ActividadOption[];
  empleados?: EmpleadoOption[];
  canSelectEmpleado?: boolean;
  defaultEmpleadoId?: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();

  const userEmail = session?.user?.email?.toLowerCase().trim();
  const allowedAdminEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const isAdmin = propIsAdmin ?? (session?.user?.rol === "ADMIN" || (userEmail ? allowedAdminEmails.includes(userEmail) : false));

  const getTodayLocal = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Form states
  const [selectedEmpleado, setSelectedEmpleado] = useState<string>(defaultEmpleadoId);
  const [tipo, setTipo] = useState<string>("P"); // Default Tipo P
  const [fecha, setFecha] = useState<string>(getTodayLocal());
  const [selectedProyecto, setSelectedProyecto] = useState<string>("");
  const [selectedActividad, setSelectedActividad] = useState<string>("");
  const [observacionInput, setObservacionInput] = useState<string>("");

  // In-Progress Active Task & Completed Log
  const [activeTask, setActiveTask] = useState<DesktopActiveTask | null>(null);
  const [completedTasks, setCompletedTasks] = useState<DesktopCompletedTask[]>([]);
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0);

  // Geolocalización automática en tiempo real
  const {
    ubicacion,
    loading: geoLoading,
    error: geoError,
    refreshLocation,
  } = useGeolocation();

  // Status & Feedback
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // --- INITIAL LOAD & LOCAL STORAGE RESTORATION ---
  useEffect(() => {
    try {
      const savedTask = localStorage.getItem("minuta_desktop_active_task");
      if (savedTask) {
        const parsed = JSON.parse(savedTask);
        if (parsed && parsed.actividad && parsed.horaInicio) {
          const todayStr = getTodayLocal();
          if (parsed.fecha && parsed.fecha !== todayStr && !isAdmin) {
            // Task from past day
            autoFinalizeOldTask(parsed);
          } else {
            setActiveTask(parsed);
            if (parsed.tipoMinuta) setTipo(parsed.tipoMinuta);
            if (parsed.empleado && canSelectEmpleado) setSelectedEmpleado(parsed.empleado);
          }
        }
      }

      const savedCompleted = localStorage.getItem("minuta_desktop_completed_tasks");
      if (savedCompleted) {
        const parsedCompleted = JSON.parse(savedCompleted);
        if (Array.isArray(parsedCompleted)) {
          setCompletedTasks(parsedCompleted);
        }
      }
    } catch (e) {
      console.error("Error al restaurar actividad activa en dashboard:", e);
    }
  }, [isAdmin, canSelectEmpleado]);

  // Sync elapsed duration counter
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
    }, 30000);

    return () => clearInterval(interval);
  }, [activeTask]);

  // Persist active task to LocalStorage
  useEffect(() => {
    try {
      if (activeTask) {
        localStorage.setItem("minuta_desktop_active_task", JSON.stringify(activeTask));
      } else {
        localStorage.removeItem("minuta_desktop_active_task");
      }
    } catch (e) {
      console.error("Error al guardar estado de actividad:", e);
    }
  }, [activeTask]);

  // Persist completed tasks to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem("minuta_desktop_completed_tasks", JSON.stringify(completedTasks));
    } catch (e) {
      console.error("Error al guardar historial de actividades:", e);
    }
  }, [completedTasks]);

  // Helper lookups
  const activeProjectInfo = useMemo(() => {
    if (!activeTask) return null;
    return proyectos.find((p) => p.code === activeTask.proyecto);
  }, [activeTask, proyectos]);

  const activeActividadInfo = useMemo(() => {
    if (!activeTask) return null;
    return actividades.find((a) => a.code === activeTask.actividad);
  }, [activeTask, actividades]);

  // Server Dispatch
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
    const res = await fetch("/api/minuta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || "Error al guardar el registro en el servidor.");
    }
    return data;
  };

  // Auto finalize past day task
  const autoFinalizeOldTask = async (oldTask: DesktopActiveTask) => {
    const safeEnd = addMinutesToTime(oldTask.horaInicio, 30);
    const taskUbicacion = oldTask.ubicacion || ubicacion;
    let formattedObs = oldTask.observacion ? oldTask.observacion.trim() : "";
    if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
      formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
    }

    const completedItem: DesktopCompletedTask = {
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
    localStorage.removeItem("minuta_desktop_active_task");

    try {
      await dispatchRecordToServer({
        empleado: canSelectEmpleado && oldTask.empleado ? oldTask.empleado : defaultEmpleadoId || undefined,
        fecha: oldTask.fecha,
        tipo: oldTask.tipoMinuta,
        intervals: [{
          proyecto: oldTask.proyecto,
          actividad: oldTask.actividad,
          horaInicio: oldTask.horaInicio,
          horaFin: safeEnd,
          observacion: formattedObs,
        }],
      });
      completedItem.synced = true;
    } catch (e) {
      console.error("Error auto-finalizando tarea anterior:", e);
    }
  };

  // 1. INICIAR O CAMBIAR ACTIVIDAD
  const handleStartOrChangeActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedProyecto.trim()) {
      setError("Debe seleccionar un proyecto válido de la lista.");
      return;
    }

    if (!selectedActividad.trim()) {
      setError("Debe seleccionar una actividad de la lista.");
      return;
    }

    if (canSelectEmpleado && !selectedEmpleado) {
      setError("Debe seleccionar un colaborador.");
      return;
    }

    const projMatch = proyectos.find((p) => p.code.toLowerCase() === selectedProyecto.trim().toLowerCase() || p.nombre.toLowerCase() === selectedProyecto.trim().toLowerCase());
    const resolvedProject = projMatch ? projMatch.code : selectedProyecto.trim();

    const actMatch = actividades.find((a) => a.code.toLowerCase() === selectedActividad.trim().toLowerCase() || a.nombre.toLowerCase() === selectedActividad.trim().toLowerCase());
    const resolvedActividad = actMatch ? actMatch.code : selectedActividad.trim();

    const nowTime = getCurrentLocalTime24();
    const finalFecha = isAdmin ? fecha : getTodayLocal();
    const targetEmp = canSelectEmpleado ? selectedEmpleado : defaultEmpleadoId || session?.user?.id;

    setLoading(true);

    try {
      // Si ya hay una actividad activa -> Finalizarla automáticamente
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

        const completedItem: DesktopCompletedTask = {
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

        await dispatchRecordToServer({
          empleado: canSelectEmpleado && activeTask.empleado ? activeTask.empleado : defaultEmpleadoId || undefined,
          fecha: activeTask.fecha,
          tipo: activeTask.tipoMinuta,
          intervals: [{
            proyecto: activeTask.proyecto,
            actividad: activeTask.actividad,
            horaInicio: activeTask.horaInicio,
            horaFin: closeTime,
            observacion: formattedObs,
          }],
        });

        completedItem.synced = true;
      }

      // Iniciar nueva actividad con hora de inicio capturada automáticamente
      const newTask: DesktopActiveTask = {
        proyecto: resolvedProject,
        actividad: resolvedActividad,
        horaInicio: nowTime,
        startTimeStamp: Date.now(),
        observacion: observacionInput.trim(),
        fecha: finalFecha,
        tipoMinuta: tipo,
        empleado: targetEmp,
        ubicacion: ubicacion || undefined,
      };

      setActiveTask(newTask);
      setObservacionInput("");
      setSuccess(
        activeTask 
          ? `Actividad previa finalizada y guardada. Nueva actividad iniciada: ${actMatch?.nombre || resolvedActividad}`
          : `Actividad iniciada correctamente: ${actMatch?.nombre || resolvedActividad}`
      );
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Error al procesar el cambio de actividad.");
    } finally {
      setLoading(false);
    }
  };

  // 2. FINALIZAR ACTIVIDAD ACTUAL
  const handleFinalizeCurrentActivity = async () => {
    if (!activeTask) return;

    setError(null);
    setSuccess(null);
    setLoading(true);

    const nowTime = getCurrentLocalTime24();
    let closeTime = nowTime;
    if (activeTask.horaInicio && closeTime <= activeTask.horaInicio) {
      closeTime = addMinutesToTime(activeTask.horaInicio, 1);
    }

    const taskUbicacion = activeTask.ubicacion || ubicacion;
    let formattedObs = activeTask.observacion ? activeTask.observacion.trim() : "";
    if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
      formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
    }

    const completedItem: DesktopCompletedTask = {
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

    try {
      await dispatchRecordToServer({
        empleado: canSelectEmpleado && activeTask.empleado ? activeTask.empleado : defaultEmpleadoId || undefined,
        fecha: activeTask.fecha,
        tipo: activeTask.tipoMinuta,
        intervals: [{
          proyecto: activeTask.proyecto,
          actividad: activeTask.actividad,
          horaInicio: activeTask.horaInicio,
          horaFin: closeTime,
          observacion: formattedObs,
        }],
      });

      completedItem.synced = true;
      setSuccess("Actividad finalizada y guardada exitosamente en el servidor.");
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Error al registrar la finalización en el servidor.");
    } finally {
      setLoading(false);
    }
  };

  // 3. ACTUALIZAR OBSERVACIÓN EN VIVO
  const handleUpdateActiveObservation = (newObs: string) => {
    setActiveTask((prev) => (prev ? { ...prev, observacion: newObs } : null));
  };

  return (
    <div className="w-full bg-white rounded-2xl shadow-md border border-brand-dark/10 p-6 md:p-8 hover:shadow-lg transition-shadow duration-300 space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-brand-dark/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center">
            <ActivityIcon className="w-5 h-5 text-brand-primary" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-brand-dark leading-tight">
              Registro de Actividad
            </h2>
            <p className="text-xs text-brand-dark/60">
              Captura y encadenamiento automático de actividades de campo.
            </p>
          </div>
        </div>
      </div>

      {/* Notificaciones */}
      {error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-r-xl text-sm flex items-start gap-2.5 animate-fadeIn">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 border-l-4 border-green-500 text-green-700 rounded-r-xl text-sm flex items-center gap-2.5 animate-fadeIn">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-green-600" />
          <span className="font-semibold">{success}</span>
        </div>
      )}

      {/* 1. ACTIVIDAD EN CURSO (SI EXISTE) */}
      {activeTask ? (
        <div className="relative overflow-hidden rounded-2xl border-2 border-brand-primary/30 bg-gradient-to-br from-white via-orange-50/30 to-white p-5 shadow-sm space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-black uppercase tracking-wider text-emerald-600">
                Actividad en Curso
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary">
                Tipo {activeTask.tipoMinuta}
              </span>
              {elapsedMinutes > 0 && (
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {elapsedMinutes} min transcurridos
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Proyecto</span>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {activeProjectInfo?.nombre || activeTask.proyecto}
                <span className="ml-2 font-mono text-xs text-slate-500 font-normal">({activeTask.proyecto})</span>
              </p>
            </div>

            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Actividad</span>
              <p className="text-sm font-bold text-brand-primary mt-0.5">
                {activeActividadInfo?.nombre || activeTask.actividad}
                {activeActividadInfo?.area && (
                  <span className="ml-1.5 text-xs text-slate-500 font-normal">({activeActividadInfo.area})</span>
                )}
              </p>
              {activeTask.ubicacion && (
                <div className="mt-1">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 shadow-sm">
                    <MapPin className="w-3.5 h-3.5 text-brand-primary" />
                    {activeTask.ubicacion}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Observación de la Actividad en Curso
            </label>
            <textarea
              placeholder="Notas, bitácora o avance de la actividad..."
              value={activeTask.observacion}
              onChange={(e) => handleUpdateActiveObservation(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-brand-primary resize-none h-14 font-medium"
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleFinalizeCurrentActivity}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 shadow-sm"
            >
              <Check className="w-4 h-4 text-emerald-600" />
              Finalizar Actividad Actual
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-slate-50 rounded-2xl border border-brand-dark/10 flex items-center gap-3 text-slate-500 text-xs">
          <Play className="w-5 h-5 text-brand-primary flex-shrink-0" />
          <span>No hay ninguna actividad en curso actualmente. Selecciona un proyecto y una actividad abajo para iniciar.</span>
        </div>
      )}

      {/* 2. FORMULARIO PARA INICIAR / CAMBIAR ACTIVIDAD */}
      <form onSubmit={handleStartOrChangeActivity} className="space-y-5">
        
        {/* Colaborador (Si es Auditor/Admin) */}
        {canSelectEmpleado && empleados.length > 0 && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1.5 flex items-center gap-1.5">
              <User className="w-4 h-4 text-brand-primary" />
              Apellido - Nombre (Colaborador)
            </label>
            <SearchableSelect
              name="empleado"
              value={selectedEmpleado}
              onChange={(val) => setSelectedEmpleado(val)}
              options={empleados.map((emp) => ({
                value: emp.id,
                label: emp.apellido_nombre,
                sublabel: emp.cargo ? `(${emp.cargo})` : undefined,
              }))}
              placeholder="Seleccione o busque un colaborador"
              required
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tipo de Registro */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1.5">
              Tipo de Registro
            </label>
            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setTipo("P")}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  tipo === "P" 
                    ? "bg-white text-brand-primary shadow-sm" 
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Tipo P
              </button>
              <button
                type="button"
                onClick={() => setTipo("O")}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  tipo === "O" 
                    ? "bg-white text-brand-primary shadow-sm" 
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Tipo O
              </button>
            </div>
          </div>

          {/* Fecha */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1.5 flex items-center justify-between">
              <span>Fecha</span>
              {!isAdmin && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                  <Lock className="w-3 h-3" /> Solo lectura (Hoy)
                </span>
              )}
            </label>
            {isAdmin ? (
              <input 
                type="date" 
                name="fecha" 
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required 
                className="w-full rounded-xl border border-brand-dark/20 px-3.5 py-2 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all bg-white text-xs font-semibold" 
              />
            ) : (
              <input 
                type="date" 
                name="fecha" 
                value={getTodayLocal()}
                readOnly
                disabled
                className="w-full rounded-xl border border-brand-dark/15 px-3.5 py-2 text-brand-dark/70 bg-slate-100 cursor-not-allowed text-xs font-semibold select-none" 
              />
            )}
          </div>
        </div>

        {/* Ubicación Actual (Geolocalización GPS) */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-brand-dark/10 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-brand-dark/80 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-brand-primary" />
              Ubicación Actual (Ciudad - Zona)
            </label>
            <button
              type="button"
              onClick={() => refreshLocation()}
              disabled={geoLoading}
              className="text-xs font-bold text-brand-primary hover:text-brand-primary/80 flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-brand-primary/10 active:scale-95 transition-all disabled:opacity-50"
              title="Actualizar ubicación vía GPS"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${geoLoading ? "animate-spin" : ""}`} />
              <span>Actualizar GPS</span>
            </button>
          </div>

          <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
              geoLoading 
                ? "bg-amber-100 text-amber-600 animate-pulse" 
                : ubicacion 
                  ? "bg-emerald-100 text-emerald-600" 
                  : "bg-slate-100 text-slate-500"
            }`}>
              <MapPin className="w-5 h-5" />
            </div>

            <div className="flex-1 min-w-0">
              {geoLoading ? (
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                  Detectando ciudad y localidad/zona vía GPS...
                </div>
              ) : ubicacion ? (
                <div>
                  <span className="text-sm font-black text-slate-900 block truncate">
                    {ubicacion}
                  </span>
                  <span className="text-[11px] text-emerald-600 font-semibold block">
                    ✓ Ubicación capturada automáticamente
                  </span>
                </div>
              ) : geoError ? (
                <div>
                  <span className="text-xs font-semibold text-amber-700 block truncate">
                    {geoError}
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    Permite el acceso a ubicación en el navegador o pulsa Actualizar
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

        {/* Proyecto & Actividad */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1">
              Proyecto (Cédula o Nombre)
            </label>
            <SearchableSelect
              name="proyecto"
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

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1">
              Actividad
            </label>
            <SearchableSelect
              name="actividad"
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
        </div>

        {/* Observación */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1">
            Observación Inicial (Opcional)
          </label>
          <input
            type="text"
            placeholder="Detalles sobre este registro..."
            value={observacionInput}
            onChange={(e) => setObservacionInput(e.target.value)}
            className="w-full rounded-xl border border-brand-dark/20 px-3.5 py-2.5 text-xs text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all font-medium"
          />
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading || !selectedProyecto.trim() || !selectedActividad.trim()}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-brand-primary text-white font-bold rounded-xl shadow-md hover:bg-brand-primary/90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
        >
          {loading ? (
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
      </form>
    </div>
  );
}
