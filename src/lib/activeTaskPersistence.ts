import { getCurrentLocalTime24, addMinutesToTime, getColombiaDateString } from "./formatTime";

export interface ActiveTaskData {
  proyecto: string;
  actividad: string;
  horaInicio: string;
  startTimeStamp?: number;
  observacion?: string;
  fecha: string;
  tipoMinuta: string;
  empleado?: string;
  ubicacion?: string;
  updatedAt?: number;
}

export interface FormDraftData {
  proyecto: string;
  actividad: string;
  observacion: string;
  tipo: string;
  updatedAt: number;
}

const STORAGE_KEYS = [
  "evo_active_task",
  "evo_active_task_backup",
  "minuta_active_task",
  "minuta_desktop_active_task",
  "minuta_pwa_active_task",
];

const COMPLETED_STORAGE_KEYS = [
  "evo_completed_tasks",
  "minuta_completed_tasks",
  "minuta_desktop_completed_tasks",
  "minuta_pwa_completed_tasks",
];

export const RELOAD_CONTINUATION_KEY = "evo_reload_continuation_task";
export const FORM_DRAFT_KEY = "evo_form_draft";

/**
 * Obtiene la tarea activa actualmente guardada en localStorage
 * Revisa todas las claves de respaldo local (Evo y legado)
 */
export function getActiveTaskFromStorage(): ActiveTaskData | null {
  if (typeof window === "undefined") return null;
  for (const key of STORAGE_KEYS) {
    try {
      const val = localStorage.getItem(key);
      if (val) {
        const parsed = JSON.parse(val);
        if (parsed && parsed.actividad && parsed.horaInicio) {
          return parsed;
        }
      }
    } catch {
      // Ignorar errores de parseo
    }
  }
  return null;
}

/**
 * Elimina la tarea activa de todos los registros de localStorage
 * Debe llamarse ÚNICAMENTE cuando el usuario finaliza la actividad o cierra sesión
 */
export function clearActiveTaskFromStorage() {
  if (typeof window === "undefined") return;
  for (const key of STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignorar
    }
  }
}

/**
 * Guarda y respalda la tarea activa en localStorage de forma redundante
 */
export function saveActiveTaskToStorage(task: ActiveTaskData) {
  if (typeof window === "undefined" || !task) return;
  try {
    const payloadWithTime = {
      ...task,
      updatedAt: Date.now(),
    };
    const serialized = JSON.stringify(payloadWithTime);
    for (const key of STORAGE_KEYS) {
      localStorage.setItem(key, serialized);
    }
  } catch (e) {
    console.error("Error al respaldar tarea activa en storage:", e);
  }
}

/**
 * Guarda el borrador actual de campos ingresados en el formulario
 * Protege contra pérdidas al recargar, actualizar o desplegar la app
 */
export function saveFormDraft(draft: { proyecto: string; actividad: string; observacion: string; tipo: string }) {
  if (typeof window === "undefined") return;
  try {
    const payload: FormDraftData = {
      ...draft,
      updatedAt: Date.now(),
    };
    localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error("Error guardando borrador del formulario:", e);
  }
}

/**
 * Recupera el borrador del formulario si existe y fue guardado en las últimas 24 horas
 */
export function getFormDraft(): FormDraftData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FORM_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.proyecto || parsed.actividad || parsed.observacion)) {
      if (!parsed.updatedAt || Date.now() - parsed.updatedAt < 24 * 60 * 60 * 1000) {
        return parsed;
      }
    }
  } catch {
    // Ignorar errores de parseo
  }
  return null;
}

/**
 * Limpia el borrador del formulario
 */
export function clearFormDraft() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(FORM_DRAFT_KEY);
  } catch {
    // Ignorar
  }
}

/**
 * Guarda un registro en la cola offline en caso de falla de red
 */
function saveToOfflineQueue(payload: any) {
  if (typeof window === "undefined") return;
  try {
    const rawQueue = localStorage.getItem("minuta_offline_queue");
    const queue = rawQueue ? JSON.parse(rawQueue) : [];
    queue.push(payload);
    localStorage.setItem("minuta_offline_queue", JSON.stringify(queue));
  } catch (err) {
    console.error("Error guardando en cola offline:", err);
  }
}

/**
 * Agrega una tarea completada al historial local
 */
function recordCompletedInStorage(completedItem: any) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem("minuta_completed_tasks");
    const list = raw ? JSON.parse(raw) : [];
    const updated = [completedItem, ...(Array.isArray(list) ? list : [])];
    const serialized = JSON.stringify(updated);
    for (const key of COMPLETED_STORAGE_KEYS) {
      localStorage.setItem(key, serialized);
    }
  } catch (err) {
    console.error("Error guardando en completedTasks:", err);
  }
}

/**
 * Despacha un payload al endpoint /api/minuta soportando fetch con keepalive
 */
async function sendPayload(payload: any, useKeepAlive: boolean = false): Promise<boolean> {
  const bodyStr = JSON.stringify(payload);

  if (typeof window !== "undefined" && (!navigator.onLine)) {
    saveToOfflineQueue(payload);
    return true;
  }

  if (useKeepAlive && typeof fetch === "function") {
    try {
      fetch("/api/minuta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyStr,
        keepalive: true,
      }).catch((e) => {
        console.warn("fetch keepalive background error:", e);
      });
      return true;
    } catch (err) {
      console.warn("Fallo fetch keepalive, probando sendBeacon:", err);
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        try {
          const blob = new Blob([bodyStr], { type: "application/json" });
          navigator.sendBeacon("/api/minuta", blob);
          return true;
        } catch (beaconErr) {
          console.error("sendBeacon también falló:", beaconErr);
        }
      }
      saveToOfflineQueue(payload);
      return false;
    }
  }

  // Fetch normal (asíncrono con await, ej. durante cierre de sesión o finalización)
  try {
    const res = await fetch("/api/minuta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyStr,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn("Respuesta no OK al guardar actividad en salida:", data);
      saveToOfflineQueue(payload);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Error enviando actividad al servidor en salida:", err);
    saveToOfflineQueue(payload);
    return false;
  }
}

/**
 * Finaliza y guarda la actividad activa en curso en la base de datos.
 * Debe llamarse cuando el usuario finaliza la actividad o cierra sesión.
 */
export async function finalizeAndSaveActiveTask(
  taskInput?: ActiveTaskData | null,
  options: { useKeepAlive?: boolean; fallbackEmpleadoId?: string } = {}
): Promise<{ saved: boolean; closeTime?: string }> {
  const task = taskInput || getActiveTaskFromStorage();
  if (!task || !task.actividad || !task.horaInicio) {
    return { saved: false };
  }

  const todayStr = getColombiaDateString();
  const nowTime = getCurrentLocalTime24();
  const useKeepAlive = !!options.useKeepAlive;

  const taskUbicacion = task.ubicacion;
  let formattedObs = task.observacion ? task.observacion.trim() : "";
  if (taskUbicacion && !formattedObs.includes(taskUbicacion)) {
    formattedObs = formattedObs ? `${formattedObs} [📍 ${taskUbicacion}]` : `[📍 ${taskUbicacion}]`;
  }

  const targetEmpleado = task.empleado || options.fallbackEmpleadoId || undefined;

  // Caso 1: Cruce de medianoche (la actividad comenzó en una fecha anterior y no ha cerrado)
  if (task.fecha && task.fecha !== todayStr) {
    let day1Start = task.horaInicio;
    if (day1Start >= "23:59") day1Start = "23:58";

    let day2End = nowTime;
    if (day2End <= "00:00") day2End = "00:01";

    const payloadDay1 = {
      empleado: targetEmpleado,
      fecha: task.fecha,
      tipo: task.tipoMinuta || "P",
      intervals: [
        {
          proyecto: task.proyecto,
          actividad: task.actividad,
          horaInicio: day1Start,
          horaFin: "23:59",
          observacion: formattedObs,
        },
      ],
    };

    const payloadDay2 = {
      empleado: targetEmpleado,
      fecha: todayStr,
      tipo: task.tipoMinuta || "P",
      intervals: [
        {
          proyecto: task.proyecto,
          actividad: task.actividad,
          horaInicio: "00:00",
          horaFin: day2End,
          observacion: formattedObs,
        },
      ],
    };

    clearActiveTaskFromStorage();

    await sendPayload(payloadDay1, useKeepAlive);
    await sendPayload(payloadDay2, useKeepAlive);

    recordCompletedInStorage({
      id: Math.random().toString(36).substring(2, 9),
      proyecto: task.proyecto,
      actividad: task.actividad,
      horaInicio: day1Start,
      horaFin: "23:59",
      observacion: formattedObs,
      fecha: task.fecha,
      tipoMinuta: task.tipoMinuta || "P",
      empleado: targetEmpleado,
      completedAt: Date.now(),
    });

    recordCompletedInStorage({
      id: Math.random().toString(36).substring(2, 9),
      proyecto: task.proyecto,
      actividad: task.actividad,
      horaInicio: "00:00",
      horaFin: day2End,
      observacion: formattedObs,
      fecha: todayStr,
      tipoMinuta: task.tipoMinuta || "P",
      empleado: targetEmpleado,
      completedAt: Date.now(),
    });

    return { saved: true, closeTime: day2End };
  }

  // Caso 2: Mismo día
  let startTime = task.horaInicio;
  let closeTime = nowTime;

  if (closeTime <= startTime) {
    closeTime = addMinutesToTime(startTime, 1);
  }

  const payload = {
    empleado: targetEmpleado,
    fecha: task.fecha || todayStr,
    tipo: task.tipoMinuta || "P",
    intervals: [
      {
        proyecto: task.proyecto,
        actividad: task.actividad,
        horaInicio: startTime,
        horaFin: closeTime,
        observacion: formattedObs,
      },
    ],
  };

  clearActiveTaskFromStorage();

  await sendPayload(payload, useKeepAlive);

  recordCompletedInStorage({
    id: Math.random().toString(36).substring(2, 9),
    proyecto: task.proyecto,
    actividad: task.actividad,
    horaInicio: startTime,
    horaFin: closeTime,
    observacion: formattedObs,
    fecha: task.fecha || todayStr,
    tipoMinuta: task.tipoMinuta || "P",
    empleado: targetEmpleado,
    completedAt: Date.now(),
  });

  return { saved: true, closeTime };
}
