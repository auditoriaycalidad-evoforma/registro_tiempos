"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  Plus, Calendar, AlertCircle, User, Lock, Play, 
  Check, ArrowRight, CheckCircle2, Activity as ActivityIcon, 
  RefreshCw, MapPin, Clock, ShieldCheck, PlusCircle, Trash2, Save
} from "lucide-react";
import { useSession } from "next-auth/react";
import { SearchableSelect } from "./SearchableSelect";
import { TimePicker12 } from "./TimePicker12";
import { getCurrentLocalTime24, addMinutesToTime, getColombiaDateString, formatTime12 } from "@/lib/formatTime";
import { useGeolocation } from "@/lib/useGeolocation";
import { filtrarActividadesPorCargo } from "@/lib/actividades";
import { 
  finalizeAndSaveActiveTask, 
  saveActiveTaskToStorage, 
  getActiveTaskFromStorage, 
  clearActiveTaskFromStorage,
  saveFormDraft,
  getFormDraft,
  clearFormDraft,
  syncActiveTaskToServer,
  fetchActiveTaskFromServer,
  deleteActiveTaskFromServer,
  patchActiveTaskObservationOnServer,
  broadcastActiveTaskChange,
  subscribeToActiveTaskChanges,
} from "@/lib/activeTaskPersistence";

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

export interface ManualInterval {
  id: string;
  proyecto: string;
  actividad: string;
  horaInicio: string;
  horaFin: string;
  observacion: string;
}

export function MinutaForm({ 
  proyectos, 
  actividades,
  empleados = [],
  canSelectEmpleado = false,
  defaultEmpleadoId = "",
  isAdmin: propIsAdmin,
  initialActiveTask = null,
}: { 
  proyectos: ProyectoOption[]; 
  actividades: ActividadOption[];
  empleados?: EmpleadoOption[];
  canSelectEmpleado?: boolean;
  defaultEmpleadoId?: string;
  isAdmin?: boolean;
  initialActiveTask?: DesktopActiveTask | null;
}) {
  const router = useRouter();
  const { data: session } = useSession();

  const userEmail = session?.user?.email?.toLowerCase().trim();
  const allowedAdminEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const isAdmin = propIsAdmin ?? (session?.user?.rol === "ADMIN" || (userEmail ? allowedAdminEmails.includes(userEmail) : false));

  const getTodayLocal = () => {
    return getColombiaDateString();
  };

  // Base Form states
  const [selectedEmpleado, setSelectedEmpleado] = useState<string>(defaultEmpleadoId || session?.user?.id || "");
  const [tipo, setTipo] = useState<string>("P"); // Default Tipo P
  const [fecha, setFecha] = useState<string>(getTodayLocal());

  // Direct open fields for Admin (Exempt from real-time and GPS restrictions)
  const [horaInicio, setHoraInicio] = useState<string>("08:00");
  const [horaFin, setHoraFin] = useState<string>("17:00");
  const [selectedProyecto, setSelectedProyecto] = useState<string>("");
  const [selectedActividad, setSelectedActividad] = useState<string>("");
  const [observacionInput, setObservacionInput] = useState<string>("");

  // Multiple intervals builder for Admin
  const [additionalIntervals, setAdditionalIntervals] = useState<ManualInterval[]>([]);
  const [showMultiIntervals, setShowMultiIntervals] = useState<boolean>(false);

  // In-Progress Active Task & Completed Log (For standard users using real-time)
  const [activeTask, setActiveTask] = useState<DesktopActiveTask | null>(() => {
    if (initialActiveTask && initialActiveTask.actividad && initialActiveTask.horaInicio) {
      return {
        ...initialActiveTask,
        startTimeStamp: initialActiveTask.startTimeStamp || Date.now(),
        observacion: initialActiveTask.observacion || "",
      };
    }
    const saved = getActiveTaskFromStorage();
    if (saved && saved.actividad && saved.horaInicio) {
      return {
        proyecto: saved.proyecto,
        actividad: saved.actividad,
        horaInicio: saved.horaInicio,
        startTimeStamp: saved.startTimeStamp || Date.now(),
        observacion: saved.observacion || "",
        fecha: saved.fecha,
        tipoMinuta: saved.tipoMinuta,
        empleado: saved.empleado,
        ubicacion: saved.ubicacion,
      };
    }
    return null;
  });
  const [completedTasks, setCompletedTasks] = useState<DesktopCompletedTask[]>([]);
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0);
  const isHandlingMidnightRef = useRef<boolean>(false);
  const activeTaskRef = useRef<DesktopActiveTask | null>(null);
  activeTaskRef.current = activeTask;
  const obsDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Geolocalización automática en tiempo real (Opcional para admin, requerida para empleados)
  const {
    ubicacion,
    loading: geoLoading,
    error: geoError,
    refreshLocation,
  } = useGeolocation(!isAdmin);

  // Status & Feedback
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Update default employee if provided
  useEffect(() => {
    if (defaultEmpleadoId && !selectedEmpleado) {
      setSelectedEmpleado(defaultEmpleadoId);
    }
  }, [defaultEmpleadoId, selectedEmpleado]);

  // Identificación dinámica del colaborador y su cargo/área
  const currentEmpleado = useMemo(() => {
    if (canSelectEmpleado || isAdmin) {
      return empleados.find((e) => e.id === selectedEmpleado) || null;
    }
    return empleados.find((e) => e.id === (defaultEmpleadoId || session?.user?.id)) || null;
  }, [empleados, selectedEmpleado, canSelectEmpleado, isAdmin, defaultEmpleadoId, session?.user?.id]);

  const currentCargo = currentEmpleado?.cargo;

  // Filtrado cruzado de actividades:
  // - Actividades que coincidan exactamente con el área o cargo del empleado.
  // - Todas las actividades cuyo campo de área sea "todas" (case-insensitive).
  const availableActividades = useMemo(() => {
    if (canSelectEmpleado || isAdmin) {
      if (!currentCargo) {
        return filtrarActividadesPorCargo(actividades, null);
      }
      return filtrarActividadesPorCargo(actividades, currentCargo);
    }
    if (currentCargo) {
      return filtrarActividadesPorCargo(actividades, currentCargo);
    }
    return actividades;
  }, [actividades, currentCargo, canSelectEmpleado, isAdmin]);

  // Resetear la actividad seleccionada si cambia el colaborador y la actividad no aplica a su nuevo cargo
  useEffect(() => {
    if (selectedActividad && availableActividades.length > 0) {
      const match = availableActividades.find(
        (a) => a.code.toLowerCase() === selectedActividad.trim().toLowerCase() || a.nombre.toLowerCase() === selectedActividad.trim().toLowerCase()
      );
      if (!match) {
        setSelectedActividad("");
      }
    }
  }, [availableActividades, selectedActividad]);

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
    try {
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
    } catch (err: any) {
      if (typeof window !== "undefined" && (!navigator.onLine || err.message === "Failed to fetch")) {
        try {
          const rawQueue = localStorage.getItem("minuta_offline_queue");
          const queue = rawQueue ? JSON.parse(rawQueue) : [];
          queue.push(payload);
          localStorage.setItem("minuta_offline_queue", JSON.stringify(queue));
          return { offline: true };
        } catch (queueErr) {
          console.error("Error guardando en cola offline:", queueErr);
        }
      }
      throw err;
    }
  };

  // --- REGLA DE CAMBIO DE DÍA (MEDIANOCHE) ---
  // Finaliza automáticamente la actividad a las 11:59 p.m. del día que culmina
  // y reinicia/crea una nueva actividad a las 12:00 a.m. para el nuevo día en curso.
  const handleMidnightCross = async (currentTask: DesktopActiveTask, newTodayStr: string) => {
    if (isHandlingMidnightRef.current) return;
    isHandlingMidnightRef.current = true;

    try {
      const d1 = new Date(currentTask.fecha + "T00:00:00");
      const d2 = new Date(newTodayStr + "T00:00:00");
      const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) return;

      const taskUbicacion = currentTask.ubicacion || ubicacion;
      let formattedObs = currentTask.observacion ? currentTask.observacion.trim() : "";
      if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
        formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
      }

      // Asegurar hora de inicio válida antes de 23:59 para el tramo del día 1
      let day1Start = currentTask.horaInicio;
      if (day1Start >= "23:59") {
        day1Start = "23:58";
      }

      const completedDay1: DesktopCompletedTask = {
        id: Math.random().toString(36).substring(2, 9),
        proyecto: currentTask.proyecto,
        actividad: currentTask.actividad,
        horaInicio: day1Start,
        horaFin: "23:59",
        observacion: currentTask.observacion,
        ubicacion: taskUbicacion,
        fecha: currentTask.fecha,
        tipoMinuta: currentTask.tipoMinuta,
        empleado: currentTask.empleado,
        synced: false,
        completedAt: Date.now(),
      };

      setCompletedTasks((prev) => [completedDay1, ...prev]);

      // Enviar cierre del día que finalizó a las 23:59 (11:59 p.m.)
      try {
        await dispatchRecordToServer({
          empleado: canSelectEmpleado && currentTask.empleado ? currentTask.empleado : defaultEmpleadoId || undefined,
          fecha: currentTask.fecha,
          tipo: currentTask.tipoMinuta,
          intervals: [{
            proyecto: currentTask.proyecto,
            actividad: currentTask.actividad,
            horaInicio: day1Start,
            horaFin: "23:59",
            observacion: formattedObs,
          }],
        });
        completedDay1.synced = true;
      } catch (err: any) {
        console.warn("No se pudo sincronizar de inmediato la actividad del día anterior a las 23:59:", err);
      }

      // Si es exactamente el día siguiente (cruce habitual de medianoche / 1 día):
      if (diffDays === 1) {
        // Timestamp a las 00:00 de hoy para que el contador de minutos transcurridos sea exacto
        let midnightStamp = Date.now();
        try {
          midnightStamp = new Date(`${newTodayStr}T00:00:00-05:00`).getTime();
          if (isNaN(midnightStamp)) {
            const mDate = new Date();
            mDate.setHours(0, 0, 0, 0);
            midnightStamp = mDate.getTime();
          }
        } catch {
          const mDate = new Date();
          mDate.setHours(0, 0, 0, 0);
          midnightStamp = mDate.getTime();
        }

        const continuationTask: DesktopActiveTask = {
          proyecto: currentTask.proyecto,
          actividad: currentTask.actividad,
          horaInicio: "00:00",
          startTimeStamp: midnightStamp,
          observacion: currentTask.observacion || "",
          fecha: newTodayStr,
          tipoMinuta: currentTask.tipoMinuta,
          empleado: currentTask.empleado,
          ubicacion: taskUbicacion,
        };

        setActiveTask(continuationTask);
        setFecha(newTodayStr);

        const serialized = JSON.stringify(continuationTask);
        localStorage.setItem("minuta_active_task", serialized);
        localStorage.setItem("minuta_desktop_active_task", serialized);
        localStorage.setItem("minuta_pwa_active_task", serialized);

        setSuccess(
          `Cruce de medianoche aplicado: Actividad anterior finalizada automáticamente a las 11:59 p.m. (${currentTask.fecha}) y nueva actividad reiniciada a las 12:00 a.m. (${newTodayStr}).`
        );
      } else {
        // Pasaron varios días: solo cerramos la tarea de ese día a las 23:59
        setActiveTask(null);
        localStorage.removeItem("minuta_active_task");
        localStorage.removeItem("minuta_desktop_active_task");
        localStorage.removeItem("minuta_pwa_active_task");
        setSuccess(`Actividad anterior del día ${currentTask.fecha} finalizada automáticamente a las 11:59 p.m.`);
      }
    } finally {
      isHandlingMidnightRef.current = false;
    }
  };

  // Compatibilidad hacia atrás
  const autoFinalizeOldTask = async (oldTask: DesktopActiveTask) => {
    const todayStr = getTodayLocal();
    await handleMidnightCross(oldTask, todayStr);
  };

  // --- CARGA INICIAL Y SINCRONIZACIÓN EN TIEMPO REAL CON EL SERVIDOR Y OTRAS PESTAÑAS/PWA ---
  useEffect(() => {
    if (isAdmin) return; // Admins use open editable fields

    const targetEmp = selectedEmpleado || defaultEmpleadoId || session?.user?.id;

    // 1. Recuperar borrador de campos del formulario
    try {
      const draft = getFormDraft();
      if (draft) {
        if (draft.proyecto) setSelectedProyecto(draft.proyecto);
        if (draft.actividad) setSelectedActividad(draft.actividad);
        if (draft.observacion) setObservacionInput(draft.observacion);
        if (draft.tipo) setTipo(draft.tipo);
      }
    } catch (e) {
      console.error("Error al restaurar borrador:", e);
    }

    // 2. Si initialActiveTask vino por SSR, sincronizar con localStorage
    if (initialActiveTask && initialActiveTask.actividad && initialActiveTask.horaInicio) {
      setActiveTask(initialActiveTask);
      saveActiveTaskToStorage(initialActiveTask);
    } else {
      // Intentar localStorage inicial
      const savedTask = getActiveTaskFromStorage();
      if (savedTask && savedTask.actividad && savedTask.horaInicio) {
        const todayStr = getTodayLocal();
        const normalizedTask: DesktopActiveTask = {
          proyecto: savedTask.proyecto,
          actividad: savedTask.actividad,
          horaInicio: savedTask.horaInicio,
          startTimeStamp: savedTask.startTimeStamp || Date.now(),
          observacion: savedTask.observacion || "",
          fecha: savedTask.fecha || todayStr,
          tipoMinuta: savedTask.tipoMinuta || "P",
          empleado: savedTask.empleado,
          ubicacion: savedTask.ubicacion,
        };

        if (normalizedTask.fecha !== todayStr) {
          handleMidnightCross(normalizedTask, todayStr).catch(console.error);
        } else {
          setActiveTask(normalizedTask);
          if (normalizedTask.tipoMinuta) setTipo(normalizedTask.tipoMinuta);
          if (normalizedTask.empleado && canSelectEmpleado) setSelectedEmpleado(normalizedTask.empleado);
        }
      }
    }

    // 3. Sincronización continua con el servidor (Dashboard <-> PWA bidireccional)
    const syncWithServer = async () => {
      try {
        const serverTask = await fetchActiveTaskFromServer(targetEmp);
        const todayStr = getTodayLocal();
        if (serverTask && serverTask.actividad && serverTask.horaInicio) {
          const normalizedTask: DesktopActiveTask = {
            proyecto: serverTask.proyecto,
            actividad: serverTask.actividad,
            horaInicio: serverTask.horaInicio,
            startTimeStamp: serverTask.startTimeStamp || Date.now(),
            observacion: serverTask.observacion || "",
            fecha: serverTask.fecha || todayStr,
            tipoMinuta: serverTask.tipoMinuta || "P",
            empleado: serverTask.empleado,
            ubicacion: serverTask.ubicacion,
          };

          if (normalizedTask.fecha !== todayStr) {
            handleMidnightCross(normalizedTask, todayStr).catch(console.error);
          } else {
            const current = activeTaskRef.current;
            const hasChanged = !current || 
              current.proyecto !== normalizedTask.proyecto ||
              current.actividad !== normalizedTask.actividad ||
              current.horaInicio !== normalizedTask.horaInicio ||
              (normalizedTask.observacion !== undefined && current.observacion !== normalizedTask.observacion);

            if (hasChanged) {
              setActiveTask(normalizedTask);
              saveActiveTaskToStorage(normalizedTask);
              if (normalizedTask.tipoMinuta) setTipo(normalizedTask.tipoMinuta);
            }
          }
        } else if (activeTaskRef.current) {
          // Si el servidor indica que no hay tarea activa (se finalizó en otro dispositivo/pestaña)
          clearActiveTaskFromStorage();
          setActiveTask(null);
        }
      } catch (e) {
        console.warn("Fallo sincronizando actividad activa con servidor:", e);
      }
    };

    syncWithServer();

    // 4. Suscribirse a cambios instantáneos entre pestañas / PWA en el mismo dispositivo
    const unsubscribeBroadcast = subscribeToActiveTaskChanges((incomingTask) => {
      if (incomingTask && incomingTask.actividad && incomingTask.horaInicio) {
        setActiveTask(incomingTask as DesktopActiveTask);
        saveActiveTaskToStorage(incomingTask);
      } else {
        clearActiveTaskFromStorage();
        setActiveTask(null);
      }
    });

    // 5. Polling periódico cada 8s para sincronización cruzada entre dispositivos (Dashboard <-> PWA)
    const pollInterval = setInterval(() => {
      syncWithServer();
    }, 8000);

    // 6. Sincronización inmediata al enfocar la pestaña o regresar a la app
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncWithServer();
      }
    };
    window.addEventListener("focus", syncWithServer);
    document.addEventListener("visibilitychange", handleVisibility);

    // 7. Restaurar historial de tareas completadas
    try {
      const savedCompleted = localStorage.getItem("evo_completed_tasks") ||
                              localStorage.getItem("minuta_completed_tasks") || 
                              localStorage.getItem("minuta_desktop_completed_tasks") || 
                              localStorage.getItem("minuta_pwa_completed_tasks");
      if (savedCompleted) {
        const parsedCompleted = JSON.parse(savedCompleted);
        if (Array.isArray(parsedCompleted)) {
          setCompletedTasks(parsedCompleted);
        }
      }
    } catch (e) {
      console.error("Error al restaurar completedTasks:", e);
    }

    return () => {
      unsubscribeBroadcast();
      clearInterval(pollInterval);
      window.removeEventListener("focus", syncWithServer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isAdmin, canSelectEmpleado, selectedEmpleado, defaultEmpleadoId, session?.user?.id, initialActiveTask]);

  // Guardado automático del borrador de campos ingresados (protege contra pérdidas por recarga/actualización/despliegue)
  useEffect(() => {
    if (isAdmin || activeTask) return;
    if (selectedProyecto || selectedActividad || observacionInput) {
      saveFormDraft({
        proyecto: selectedProyecto,
        actividad: selectedActividad,
        observacion: observacionInput,
        tipo,
      });
    }
  }, [selectedProyecto, selectedActividad, observacionInput, tipo, isAdmin, activeTask]);

  // Respaldo continuo de la tarea activa en localStorage
  useEffect(() => {
    if (isAdmin) return;
    try {
      if (activeTask) {
        saveActiveTaskToStorage(activeTask);
      } else {
        clearActiveTaskFromStorage();
      }
    } catch (e) {
      console.error("Error al respaldar activeTask en localStorage:", e);
    }
  }, [activeTask, isAdmin]);

  // Sync completed tasks to localStorage
  useEffect(() => {
    if (isAdmin) return;
    try {
      if (completedTasks.length > 0) {
        const serialized = JSON.stringify(completedTasks);
        localStorage.setItem("evo_completed_tasks", serialized);
        localStorage.setItem("minuta_completed_tasks", serialized);
        localStorage.setItem("minuta_desktop_completed_tasks", serialized);
        localStorage.setItem("minuta_pwa_completed_tasks", serialized);
      }
    } catch (e) {
      console.error("Error al guardar completedTasks en localStorage:", e);
    }
  }, [completedTasks, isAdmin]);

  // Sync elapsed duration counter & Check midnight rollover in real-time
  useEffect(() => {
    if (!activeTask) {
      setElapsedMinutes(0);
      return;
    }

    const checkMidnightAndSyncTimer = () => {
      const todayStr = getTodayLocal();
      if (activeTask.fecha && activeTask.fecha !== todayStr) {
        handleMidnightCross(activeTask, todayStr).catch(console.error);
        return;
      }

      if (!activeTask.startTimeStamp) return;
      const diffMs = Math.max(0, Date.now() - activeTask.startTimeStamp);
      setElapsedMinutes(Math.floor(diffMs / 60000));

      // Respaldo periódico redundante en storage (heartbeat cada 15s)
      saveActiveTaskToStorage(activeTask);
    };

    checkMidnightAndSyncTimer();
    const interval = setInterval(checkMidnightAndSyncTimer, 15000); // Chequeo periódico cada 15s

    return () => clearInterval(interval);
  }, [activeTask]);

  // ==========================================
  // 1. ADMIN DIRECT OPEN-FIELDS SUBMISSION
  // ==========================================
  const handleAdminDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const targetEmp = (canSelectEmpleado || isAdmin) && selectedEmpleado 
      ? selectedEmpleado 
      : defaultEmpleadoId || session?.user?.id;

    if (!targetEmp) {
      setError("Debe seleccionar un colaborador.");
      return;
    }

    if (!fecha) {
      setError("Debe especificar una fecha de registro.");
      return;
    }

    // Build list of intervals to submit
    const intervalsToSubmit: {
      proyecto: string;
      actividad: string;
      horaInicio: string;
      horaFin: string;
      observacion: string;
    }[] = [];

    // Main interval
    if (!selectedProyecto.trim()) {
      setError("Debe seleccionar un proyecto válido.");
      return;
    }
    if (!selectedActividad.trim()) {
      setError("Debe seleccionar una actividad.");
      return;
    }
    if (!horaInicio || !horaFin) {
      setError("Debe ingresar la hora de inicio y fin.");
      return;
    }
    if (horaFin <= horaInicio) {
      setError(`La hora de fin (${horaFin}) debe ser posterior a la hora de inicio (${horaInicio}).`);
      return;
    }

    const projMatch = proyectos.find(
      (p) => p.code.toLowerCase() === selectedProyecto.trim().toLowerCase() || p.nombre.toLowerCase() === selectedProyecto.trim().toLowerCase()
    );
    const resolvedProject = projMatch ? projMatch.code : selectedProyecto.trim();

    const actMatch = actividades.find(
      (a) => a.code.toLowerCase() === selectedActividad.trim().toLowerCase() || a.nombre.toLowerCase() === selectedActividad.trim().toLowerCase()
    );
    const resolvedActividad = actMatch ? actMatch.code : selectedActividad.trim();

    intervalsToSubmit.push({
      proyecto: resolvedProject,
      actividad: resolvedActividad,
      horaInicio: horaInicio.trim(),
      horaFin: horaFin.trim(),
      observacion: observacionInput.trim(),
    });

    // Additional intervals if present
    for (let i = 0; i < additionalIntervals.length; i++) {
      const inv = additionalIntervals[i];
      if (!inv.proyecto || !inv.actividad || !inv.horaInicio || !inv.horaFin) {
        setError(`Debe completar todos los campos del intervalo adicional #${i + 1}.`);
        return;
      }
      if (inv.horaFin <= inv.horaInicio) {
        setError(`En el intervalo #${i + 2}, la hora de fin debe ser posterior a la hora de inicio.`);
        return;
      }

      const pM = proyectos.find(
        (p) => p.code.toLowerCase() === inv.proyecto.trim().toLowerCase() || p.nombre.toLowerCase() === inv.proyecto.trim().toLowerCase()
      );
      const aM = actividades.find(
        (a) => a.code.toLowerCase() === inv.actividad.trim().toLowerCase() || a.nombre.toLowerCase() === inv.actividad.trim().toLowerCase()
      );

      intervalsToSubmit.push({
        proyecto: pM ? pM.code : inv.proyecto.trim(),
        actividad: aM ? aM.code : inv.actividad.trim(),
        horaInicio: inv.horaInicio.trim(),
        horaFin: inv.horaFin.trim(),
        observacion: inv.observacion.trim(),
      });
    }

    setLoading(true);

    try {
      await dispatchRecordToServer({
        empleado: targetEmp,
        fecha: fecha,
        tipo: tipo,
        intervals: intervalsToSubmit,
      });

      setSuccess(`¡${intervalsToSubmit.length} registro(s) de actividad guardado(s) exitosamente!`);
      clearFormDraft();
      setObservacionInput("");
      setAdditionalIntervals([]);
      setShowMultiIntervals(false);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Error al procesar el guardado del registro.");
    } finally {
      setLoading(false);
    }
  };

  // Add an additional interval row (for admins entering a full schedule)
  const handleAddIntervalRow = () => {
    const lastEnd = additionalIntervals.length > 0 
      ? additionalIntervals[additionalIntervals.length - 1].horaFin 
      : horaFin || "12:00";
    
    const newEnd = addMinutesToTime(lastEnd, 60);

    setAdditionalIntervals((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        proyecto: selectedProyecto,
        actividad: selectedActividad,
        horaInicio: lastEnd,
        horaFin: newEnd,
        observacion: "",
      },
    ]);
    setShowMultiIntervals(true);
  };

  const handleRemoveIntervalRow = (id: string) => {
    setAdditionalIntervals((prev) => prev.filter((inv) => inv.id !== id));
  };

  const handleUpdateAdditionalInterval = (id: string, field: keyof ManualInterval, val: string) => {
    setAdditionalIntervals((prev) =>
      prev.map((inv) => (inv.id === id ? { ...inv, [field]: val } : inv))
    );
  };

  // ==========================================
  // 2. STANDARD REAL-TIME TASK MANAGEMENT
  // ==========================================
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

    const projMatch = proyectos.find((p) => p.code.toLowerCase() === selectedProyecto.trim().toLowerCase() || p.nombre.toLowerCase() === selectedProyecto.trim().toLowerCase());
    const resolvedProject = projMatch ? projMatch.code : selectedProyecto.trim();

    const actMatch = actividades.find((a) => a.code.toLowerCase() === selectedActividad.trim().toLowerCase() || a.nombre.toLowerCase() === selectedActividad.trim().toLowerCase());
    const resolvedActividad = actMatch ? actMatch.code : selectedActividad.trim();

    const nowTime = getCurrentLocalTime24();
    const finalFecha = getTodayLocal();
    const targetEmp = defaultEmpleadoId || session?.user?.id;

    setLoading(true);

    try {
      let lastCloseTime: string | null = null;

      // Si ya hay una actividad activa -> Finalizarla automáticamente
      if (activeTask) {
        const taskUbicacion = activeTask.ubicacion || ubicacion;
        let formattedObs = activeTask.observacion ? activeTask.observacion.trim() : "";
        if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
          formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
        }

        // Si la actividad previa cruzó la medianoche
        if (activeTask.fecha && activeTask.fecha !== finalFecha) {
          let day1Start = activeTask.horaInicio;
          if (day1Start >= "23:59") day1Start = "23:58";

          try {
            // Guardar tramo de ayer hasta 23:59
            await dispatchRecordToServer({
              empleado: canSelectEmpleado && activeTask.empleado ? activeTask.empleado : defaultEmpleadoId || undefined,
              fecha: activeTask.fecha,
              tipo: activeTask.tipoMinuta,
              intervals: [{
                proyecto: activeTask.proyecto,
                actividad: activeTask.actividad,
                horaInicio: day1Start,
                horaFin: "23:59",
                observacion: formattedObs,
              }],
            });

            // Guardar tramo de hoy desde 00:00 hasta nowTime si han transcurrido minutos hoy
            if (nowTime > "00:00") {
              await dispatchRecordToServer({
                empleado: canSelectEmpleado && activeTask.empleado ? activeTask.empleado : defaultEmpleadoId || undefined,
                fecha: finalFecha,
                tipo: activeTask.tipoMinuta,
                intervals: [{
                  proyecto: activeTask.proyecto,
                  actividad: activeTask.actividad,
                  horaInicio: "00:00",
                  horaFin: nowTime,
                  observacion: formattedObs,
                }],
              });
              lastCloseTime = nowTime;
            } else {
              lastCloseTime = "00:00";
            }
          } catch (splitErr) {
            console.warn("Error guardando tramos de actividad previa con cambio de fecha:", splitErr);
          }
        } else {
          // Mismo día
          let closeTime = nowTime;
          if (activeTask.horaInicio && closeTime <= activeTask.horaInicio) {
            closeTime = addMinutesToTime(activeTask.horaInicio, 1);
          }
          lastCloseTime = closeTime;

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

          try {
            await dispatchRecordToServer({
              empleado: defaultEmpleadoId || undefined,
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
          } catch (dispatchErr: any) {
            console.warn("No se pudo enviar la actividad previa al servidor inmediatamente:", dispatchErr);
          }
        }
      } else {
        // No había actividad activa: verificar si hay tareas completadas hoy para evitar solapamiento
        const recentForToday = completedTasks.find((t) => t.fecha === finalFecha);
        if (recentForToday && recentForToday.horaFin > nowTime) {
          lastCloseTime = recentForToday.horaFin;
        }
      }

      // Iniciar nueva actividad asegurando que horaInicio NUNCA sea menor a lastCloseTime
      // (Previene solapamientos cuando una tarea previa se finalizó dentro del mismo minuto forzando un minuto adicional)
      let effectiveStartTime = (lastCloseTime && lastCloseTime > nowTime) ? lastCloseTime : nowTime;
      const recentForToday = completedTasks.find((t) => t.fecha === finalFecha);
      if (recentForToday && recentForToday.horaFin > effectiveStartTime) {
        effectiveStartTime = recentForToday.horaFin;
      }

      const newTask: DesktopActiveTask = {
        proyecto: resolvedProject,
        actividad: resolvedActividad,
        horaInicio: effectiveStartTime,
        startTimeStamp: Date.now(),
        observacion: observacionInput.trim(),
        fecha: finalFecha,
        tipoMinuta: tipo,
        empleado: targetEmp,
        ubicacion: ubicacion || undefined,
      };

      clearFormDraft();
      saveActiveTaskToStorage(newTask);
      setActiveTask(newTask);
      syncActiveTaskToServer(newTask).catch(console.error);
      broadcastActiveTaskChange(newTask);
      setSelectedProyecto("");
      setSelectedActividad("");
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

  const handleFinalizeCurrentActivity = async () => {
    if (!activeTask) return;

    setError(null);
    setSuccess(null);
    setLoading(true);

    const todayStr = getTodayLocal();
    const nowTime = getCurrentLocalTime24();

    // Caso 1: Si la actividad activa cruzó la medianoche sin haber finalizado aún
    if (activeTask.fecha && activeTask.fecha !== todayStr) {
      const taskUbicacion = activeTask.ubicacion || ubicacion;
      let formattedObs = activeTask.observacion ? activeTask.observacion.trim() : "";
      if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
        formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
      }

      let day1Start = activeTask.horaInicio;
      if (day1Start >= "23:59") day1Start = "23:58";

      let day2End = nowTime;
      if (day2End <= "00:00") day2End = "00:01";

      clearActiveTaskFromStorage();
      clearFormDraft();
      setActiveTask(null);
      const targetEmp = (canSelectEmpleado && activeTask.empleado) || defaultEmpleadoId || session?.user?.id;
      deleteActiveTaskFromServer(targetEmp).catch(console.error);
      broadcastActiveTaskChange(null);

      try {
        // Enviar tramo 1 (día anterior hasta 23:59)
        await dispatchRecordToServer({
          empleado: canSelectEmpleado && activeTask.empleado ? activeTask.empleado : defaultEmpleadoId || undefined,
          fecha: activeTask.fecha,
          tipo: activeTask.tipoMinuta,
          intervals: [{
            proyecto: activeTask.proyecto,
            actividad: activeTask.actividad,
            horaInicio: day1Start,
            horaFin: "23:59",
            observacion: formattedObs,
          }],
        });

        // Enviar tramo 2 (nuevo día de 00:00 a nowTime)
        await dispatchRecordToServer({
          empleado: canSelectEmpleado && activeTask.empleado ? activeTask.empleado : defaultEmpleadoId || undefined,
          fecha: todayStr,
          tipo: activeTask.tipoMinuta,
          intervals: [{
            proyecto: activeTask.proyecto,
            actividad: activeTask.actividad,
            horaInicio: "00:00",
            horaFin: day2End,
            observacion: formattedObs,
          }],
        });

        setSuccess(`Actividad finalizada con cruce de medianoche: se guardaron los tramos ${activeTask.fecha} (${day1Start} - 23:59) y ${todayStr} (00:00 - ${day2End}).`);
        router.refresh();
      } catch (err: any) {
        setError(err?.message || "Error al registrar la finalización con cruce de día en el servidor.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Caso 2: Actividad dentro del mismo día
    let startTime = activeTask.horaInicio;
    let closeTime = nowTime;

    // Prevención de solapamiento: si una tarea completada hoy terminó después de startTime (ej. 16:53 vs 16:52):
    const recentCompletedToday = completedTasks.find((t) => t.fecha === activeTask.fecha);
    if (recentCompletedToday && recentCompletedToday.horaFin > startTime && recentCompletedToday.horaFin < closeTime) {
      startTime = recentCompletedToday.horaFin;
    }

    if (closeTime <= startTime) {
      closeTime = addMinutesToTime(startTime, 1);
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
      horaInicio: startTime,
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
    clearActiveTaskFromStorage();
    clearFormDraft();
    setActiveTask(null);
    const targetEmp = (canSelectEmpleado && activeTask.empleado) || defaultEmpleadoId || session?.user?.id;
    deleteActiveTaskFromServer(targetEmp).catch(console.error);
    broadcastActiveTaskChange(null);

    try {
      await dispatchRecordToServer({
        empleado: defaultEmpleadoId || undefined,
        fecha: activeTask.fecha,
        tipo: activeTask.tipoMinuta,
        intervals: [{
          proyecto: activeTask.proyecto,
          actividad: activeTask.actividad,
          horaInicio: startTime,
          horaFin: closeTime,
          observacion: formattedObs,
        }],
      });

      completedItem.synced = true;
      setSuccess("Actividad finalizada y guardada exitosamente en el servidor.");
      router.refresh();
    } catch (err: any) {
      const errMsg = err?.message || "";
      // Autocorrección de solapamiento si existe un registro previo guardado en BD (ej. 16:52 - 16:53)
      const matchOverlap = errMsg.match(/se solapa con un registro guardado en la base de datos \((\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\)/);
      if (matchOverlap) {
        const conflictingEnd = matchOverlap[2];
        if (conflictingEnd > startTime && conflictingEnd < closeTime) {
          try {
            await dispatchRecordToServer({
              empleado: defaultEmpleadoId || undefined,
              fecha: activeTask.fecha,
              tipo: activeTask.tipoMinuta,
              intervals: [{
                proyecto: activeTask.proyecto,
                actividad: activeTask.actividad,
                horaInicio: conflictingEnd,
                horaFin: closeTime,
                observacion: formattedObs,
              }],
            });
            completedItem.horaInicio = conflictingEnd;
            completedItem.synced = true;
            setSuccess(`Actividad finalizada y guardada (${conflictingEnd} - ${closeTime}). Se ajustó el inicio automáticamente para resolver el solapamiento con el registro previo.`);
            router.refresh();
            return;
          } catch (retryErr: any) {
            console.error("Fallo segundo intento tras ajustar solapamiento:", retryErr);
          }
        }
      }
      setError(errMsg || "Error al registrar la finalización en el servidor.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateActiveObservation = (newObs: string) => {
    setActiveTask((prev) => {
      if (!prev) return null;
      const updated = { ...prev, observacion: newObs };
      saveActiveTaskToStorage(updated);
      return updated;
    });

    if (obsDebounceRef.current) {
      clearTimeout(obsDebounceRef.current);
    }
    obsDebounceRef.current = setTimeout(() => {
      const currentEmp = (canSelectEmpleado && activeTaskRef.current?.empleado) || defaultEmpleadoId || session?.user?.id;
      patchActiveTaskObservationOnServer(newObs, currentEmp).catch(console.error);
      broadcastActiveTaskChange(activeTaskRef.current);
    }, 500);
  };

  // =========================================================================
  // RENDER: ADMIN VIEW (OPEN EDITABLE FIELDS & GPS EXEMPTION)
  // =========================================================================
  if (isAdmin) {
    return (
      <div className="w-full bg-white rounded-2xl shadow-md border border-brand-dark/10 p-6 md:p-8 hover:shadow-lg transition-shadow duration-300 space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-brand-dark/10 pb-4 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-brand-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-brand-dark leading-tight">
                  Registro de Actividades (Administración)
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                  Campos Abiertos
                </span>
              </div>
              <p className="text-xs text-brand-dark/60">
                Edición libre de fecha, hora de inicio y fin, colaborador y exención de GPS.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              GPS Exento (Opcional)
            </span>
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

        {/* Formulario con Campos Libres y Editables */}
        <form onSubmit={handleAdminDirectSubmit} className="space-y-5">
          
          {/* Fila 1: Colaborador (Cualquier empleado) */}
          {empleados.length > 0 && (
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
                placeholder="Seleccione el colaborador al que se asigna la actividad"
                required
              />
            </div>
          )}

          {/* Fila 2: Tipo de Registro y Fecha Libre */}
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
                  Tipo P (Habitual)
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
                  Tipo O (Horas Extras)
                </button>
              </div>
            </div>

            {/* Fecha Libre y Editable */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1.5 flex items-center justify-between">
                <span>Fecha de la Actividad</span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  Libre / Cualquier Fecha
                </span>
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-brand-primary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input 
                  type="date" 
                  name="fecha" 
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  required 
                  className="w-full rounded-xl border border-brand-dark/20 pl-10 pr-3.5 py-2 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all bg-white text-xs font-semibold shadow-2xs" 
                />
              </div>
            </div>
          </div>

          {/* Fila 3: Horarios Libres (Hora Inicio & Hora Fin) */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-brand-dark/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-brand-dark flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-brand-primary" />
                Horarios de la Actividad (Campos Libres)
              </span>
              <span className="text-[10px] text-slate-500 font-semibold">
                Formato 12 horas (AM/PM) o 24 horas
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Hora de Inicio
                </label>
                <TimePicker12
                  value={horaInicio}
                  onChange={(val) => setHoraInicio(val)}
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Hora de Fin
                </label>
                <TimePicker12
                  value={horaFin}
                  onChange={(val) => setHoraFin(val)}
                  required
                />
              </div>
            </div>
          </div>

          {/* Fila 4: Proyecto & Actividad */}
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
                  Actividad {currentCargo && <span className="text-brand-primary normal-case font-normal text-[11px]">({currentCargo} + TODAS)</span>}
                </label>
                <SearchableSelect
                  name="actividad"
                  value={selectedActividad}
                  onChange={(val) => setSelectedActividad(val)}
                  options={availableActividades.map((a) => ({
                    value: a.code,
                    label: a.nombre,
                    sublabel: a.area ? `(${a.area})` : undefined,
                  }))}
                  placeholder="Busque o seleccione una actividad"
                  required
                />
              </div>
          </div>

          {/* Fila 5: Observación */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1">
              Observación / Bitácora (Opcional)
            </label>
            <input
              type="text"
              placeholder="Detalles sobre este registro..."
              value={observacionInput}
              onChange={(e) => setObservacionInput(e.target.value)}
              className="w-full rounded-xl border border-brand-dark/20 px-3.5 py-2.5 text-xs text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all font-medium"
            />
          </div>

          {/* Intervalos Adicionales (Opcional para ingresar varias actividades) */}
          {additionalIntervals.length > 0 && (
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-brand-dark">
                Intervalos Adicionales para esta Fecha ({additionalIntervals.length})
              </h3>
              {additionalIntervals.map((inv, idx) => (
                <div key={inv.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 relative animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-brand-primary">
                      Actividad Adicional #{idx + 2}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveIntervalRow(inv.id)}
                      className="text-red-500 hover:text-red-700 text-xs font-bold p-1 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Quitar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Hora Inicio</label>
                      <TimePicker12
                        value={inv.horaInicio}
                        onChange={(val) => handleUpdateAdditionalInterval(inv.id, "horaInicio", val)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Hora Fin</label>
                      <TimePicker12
                        value={inv.horaFin}
                        onChange={(val) => handleUpdateAdditionalInterval(inv.id, "horaFin", val)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SearchableSelect
                      name={`proj_${inv.id}`}
                      value={inv.proyecto}
                      onChange={(val) => handleUpdateAdditionalInterval(inv.id, "proyecto", val)}
                      options={proyectos.map((p) => ({
                        value: p.code,
                        label: p.code,
                        sublabel: p.nombre,
                      }))}
                      placeholder="Proyecto"
                    />
                    <SearchableSelect
                      name={`act_${inv.id}`}
                      value={inv.actividad}
                      onChange={(val) => handleUpdateAdditionalInterval(inv.id, "actividad", val)}
                      options={availableActividades.map((a) => ({
                        value: a.code,
                        label: a.nombre,
                        sublabel: a.area ? `(${a.area})` : undefined,
                      }))}
                      placeholder="Actividad"
                    />
                  </div>

                  <input
                    type="text"
                    placeholder="Observación..."
                    value={inv.observacion}
                    onChange={(e) => handleUpdateAdditionalInterval(inv.id, "observacion", e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Botones de Acción */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={handleAddIntervalRow}
              className="px-4 py-3 border-2 border-dashed border-brand-primary/40 hover:border-brand-primary text-brand-primary font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-98 bg-orange-50/20 hover:bg-orange-50/50"
            >
              <PlusCircle className="w-4 h-4" />
              <span>+ Añadir otra actividad a esta fecha</span>
            </button>

            <button
              type="submit"
              disabled={loading || !selectedProyecto.trim() || !selectedActividad.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 px-6 bg-brand-primary text-white font-bold rounded-xl shadow-md hover:bg-brand-primary/90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Guardar Registro de Actividad</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // =========================================================================
  // RENDER: STANDARD EMPLOYEE VIEW (REAL-TIME TIMER + GPS)
  // =========================================================================
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
              Registro de Actividad en Tiempo Real
            </h2>
            <p className="text-xs text-brand-dark/60">
              Captura y encadenamiento automático de actividades de campo.
            </p>
          </div>
        </div>
      </div>

      {/* Notificaciones */}
      {recoveryNotice && (
        <div className="p-3 bg-blue-50 border-l-4 border-blue-500 text-blue-700 rounded-r-xl text-xs flex items-center justify-between gap-2.5 animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-blue-600" />
            <span className="font-semibold">{recoveryNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setRecoveryNotice(null)}
            className="text-blue-500 hover:text-blue-700 text-xs font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}
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

      {/* Actividad en Curso (si existe) */}
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

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 flex items-center gap-1 border border-slate-200/60">
                {isAdmin ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-brand-primary" />
                    Inicio: {formatTime12(activeTask.horaInicio)} ({activeTask.fecha})
                  </>
                ) : (
                  <>
                    <Calendar className="w-3.5 h-3.5 text-brand-primary" />
                    {activeTask.fecha}
                  </>
                )}
              </span>
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

      {/* Formulario Estándar */}
      <form onSubmit={handleStartOrChangeActivity} className="space-y-5">
        
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

          {/* Fecha (Solo lectura hoy para estándar) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80 mb-1.5 flex items-center justify-between">
              <span>Fecha</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                <Lock className="w-3 h-3" /> Solo lectura (Hoy)
              </span>
            </label>
            <input 
              type="date" 
              name="fecha" 
              value={getTodayLocal()}
              readOnly
              disabled
              className="w-full rounded-xl border border-brand-dark/15 px-3.5 py-2 text-brand-dark/70 bg-slate-100 cursor-not-allowed text-xs font-semibold select-none" 
            />
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
              Actividad {currentCargo && <span className="text-brand-primary normal-case font-normal text-[11px]">({currentCargo} + TODAS)</span>}
            </label>
            <SearchableSelect
              name="actividad"
              value={selectedActividad}
              onChange={(val) => setSelectedActividad(val)}
              options={availableActividades.map((a) => ({
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
