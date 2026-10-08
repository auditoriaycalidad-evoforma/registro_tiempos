export function formatTime24(date: Date | string): string {
  if (!date) return "";
  if (typeof date === "string") {
    if (date.includes("T")) {
      const parts = date.split("T");
      if (parts[1]) return parts[1].substring(0, 5);
    }
    if (/^\d{2}:\d{2}$/.test(date)) {
      return date;
    }
  }
  const value = new Date(date);
  if (isNaN(value.getTime())) return typeof date === "string" ? date : "";
  const hours = value.getUTCHours().toString().padStart(2, "0");
  const minutes = value.getUTCMinutes().toString().padStart(2, "0");

  return `${hours}:${minutes}`;
}

export function militaryTo12h(time24: string): { hour: string; minute: string; period: "AM" | "PM" } {
  if (!time24 || !time24.includes(":")) {
    return { hour: "", minute: "", period: "AM" };
  }
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const m = (mStr || "00").replace(/[^0-9]/g, "").padStart(2, "0").slice(0, 2);
  if (isNaN(h)) return { hour: "", minute: "", period: "AM" };
  
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  if (h === 0) {
    h = 12;
  } else if (h > 12) {
    h = h - 12;
  }
  return {
    hour: String(h).padStart(2, "0"),
    minute: m,
    period,
  };
}

export function toMilitaryTime(hourStr: string, minuteStr: string, period: "AM" | "PM"): string {
  if (!hourStr) return "";
  let h = parseInt(hourStr, 10);
  let m = parseInt(minuteStr || "0", 10);
  if (isNaN(h)) return "";
  if (isNaN(m)) m = 0;

  if (h < 1 || h > 12 || m < 0 || m > 59) return "";

  if (period === "AM") {
    if (h === 12) h = 0;
  } else {
    // PM
    if (h !== 12) h += 12;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatTime12(dateOrStr: Date | string | null | undefined): string {
  if (!dateOrStr) return "-";
  const time24 = formatTime24(dateOrStr);
  if (!time24 || !time24.includes(":")) return "-";
  const { hour, minute, period } = militaryTo12h(time24);
  if (!hour) return time24;
  return `${hour}:${minute} ${period}`;
}

export function getCurrentLocalTime24(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function addMinutesToTime(time24: string, minutesToAdd: number): string {
  if (!time24 || !time24.includes(":")) return getCurrentLocalTime24();
  const [hStr, mStr] = time24.split(":");
  let totalMin = parseInt(hStr, 10) * 60 + parseInt(mStr, 10) + minutesToAdd;
  if (totalMin >= 24 * 60) totalMin = (24 * 60) - 1;
  if (totalMin < 0) totalMin = 0;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Retorna la fecha en formato YYYY-MM-DD para la zona horaria de Colombia (America/Bogota, UTC-5).
 */
export function getColombiaDateString(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    const utcTime = d.getTime();
    const cotOffset = -5 * 60 * 60 * 1000;
    const cotDate = new Date(utcTime + cotOffset);
    const y = cotDate.getUTCFullYear();
    const m = String(cotDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cotDate.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

/**
 * Valida si la fecha enviada por un usuario estándar es válida.
 * Permite registrar actividades de hoy y de ayer (en hora de Colombia / UTC-5)
 * para garantizar soporte a turnos nocturnos, cierres de jornada después de las 7:00 p.m.
 * y auto-finalización sin bloqueos de tareas del día previo.
 */
export function isAllowedStandardUserDate(fechaStr: string): boolean {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return false;

  const now = new Date();

  // 1. Hoy en Colombia (America/Bogota, UTC-5)
  const todayCol = getColombiaDateString(now);
  if (fechaStr === todayCol) return true;

  // 2. Ayer en Colombia (margen de cierre de turno y auto-finalización)
  const yesterdayCol = getColombiaDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (fechaStr === yesterdayCol) return true;

  // 3. Hoy y ayer en UTC / Servidor (para tolerancia de reloj de servidor)
  const todayUtc = now.toISOString().split("T")[0];
  if (fechaStr === todayUtc) return true;

  const yesterdayUtc = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  if (fechaStr === yesterdayUtc) return true;

  // 4. Mañana en Colombia (margen de desajuste leve de reloj del cliente)
  const tomorrowCol = getColombiaDateString(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (fechaStr === tomorrowCol) return true;

  return false;
}


