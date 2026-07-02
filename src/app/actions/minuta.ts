"use server";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { syncMinutasToSheets } from "./exportar";

import { formatTime24 } from "@/lib/formatTime";

export async function createMinuta(formData: FormData) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return { error: "No autorizado" };
  }

  const data = {
    fecha: formData.get("fecha") as string,
    tipo: formData.get("tipo") as string, // "A" o "B"
  };

  // Validaciones básicas de campos principales
  if (!data.fecha || !data.tipo) {
    return { error: "Todos los campos principales son obligatorios" };
  }

  // Validar que la fecha no sea superior a dos días después del día en curso
  const hoy = new Date();
  const hoySoloFecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const limiteMaximo = new Date(hoySoloFecha);
  limiteMaximo.setDate(limiteMaximo.getDate() + 2);

  const [year, month, day] = data.fecha.split("-").map(Number);
  const fechaIngresada = new Date(year, month - 1, day);

  if (fechaIngresada > limiteMaximo) {
    return { error: "No es posible registrar tiempos para fechas con más de dos días de posterioridad a la fecha actual." };
  }

  // Extraer y procesar múltiples rangos de horario
  const intervals: { 
    proyecto: string; 
    actividad: string; 
    horaInicio: string; 
    horaFin: string; 
    observacion: string; 
  }[] = [];
  
  const keys = Array.from(formData.keys());
  const startKeys = keys.filter(k => k.startsWith("horaInicio_")).sort();
  
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  
  for (const startKey of startKeys) {
    const idx = startKey.split("_")[1];
    const start = formData.get(`horaInicio_${idx}`) as string;
    const end = formData.get(`horaFin_${idx}`) as string;
    const proyecto = formData.get(`proyecto_${idx}`) as string;
    const actividad = formData.get(`actividad_${idx}`) as string;
    const observacion = (formData.get(`observacion_${idx}`) as string) || "";
    
    if (start || end || proyecto || actividad || observacion) {
      if (!start || !end || !proyecto || !actividad) {
        return { error: `Debe completar Cédula, Actividad, Hora de Inicio y Hora de Fin para el rango #${parseInt(idx) + 1}.` };
      }
      
      const trimmedStart = start.trim();
      const trimmedEnd = end.trim();
      
      if (!timePattern.test(trimmedStart) || !timePattern.test(trimmedEnd)) {
        return { error: "Las horas deben estar en formato de 24 horas (HH:MM)" };
      }
      
      if (trimmedEnd <= trimmedStart) {
        return { error: `La hora de fin (${trimmedEnd}) debe ser posterior a la hora de inicio (${trimmedStart})` };
      }
      
      intervals.push({ 
        proyecto: proyecto.trim(), 
        actividad: actividad.trim(), 
        horaInicio: trimmedStart, 
        horaFin: trimmedEnd,
        observacion: observacion.trim()
      });
    }
  }

  if (intervals.length === 0) {
    return { error: "Debe registrar al menos un rango de tiempo." };
  }

  // Función para convertir HH:MM a minutos desde la medianoche
  function timeToMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  // Validar solapamientos entre los nuevos intervalos
  for (let i = 0; i < intervals.length; i++) {
    const startI = timeToMinutes(intervals[i].horaInicio);
    const endI = timeToMinutes(intervals[i].horaFin);
    for (let j = i + 1; j < intervals.length; j++) {
      const startJ = timeToMinutes(intervals[j].horaInicio);
      const endJ = timeToMinutes(intervals[j].horaFin);
      
      if (startI < endJ && startJ < endI) {
        return { error: `Los rangos ingresados se solapan entre sí: ${intervals[i].horaInicio}-${intervals[i].horaFin} y ${intervals[j].horaInicio}-${intervals[j].horaFin}` };
      }
    }
  }

  try {
    // Formatear fecha para Prisma
    const fechaDate = new Date(`${data.fecha}T00:00:00.000Z`);

    // Validar solapamiento con registros existentes en la base de datos para este empleado en esta fecha
    const existing = await prisma.minuta_registro_actividad.findMany({
      where: {
        empleado: session.user.id,
        fecha: fechaDate,
      },
    });

    for (const interval of intervals) {
      const startMin = timeToMinutes(interval.horaInicio);
      const endMin = timeToMinutes(interval.horaFin);

      for (const record of existing) {
        const recStartStr = formatTime24(record.hora_inicio);
        const recEndStr = formatTime24(record.hora_fin);
        const recStartMin = timeToMinutes(recStartStr);
        const recEndMin = timeToMinutes(recEndStr);

        if (startMin < recEndMin && recStartMin < endMin) {
          return {
            error: `El rango ${interval.horaInicio} - ${interval.horaFin} se solapa con una actividad ya registrada en este día (${recStartStr} - ${recEndStr})`
          };
        }
      }
    }

    // Validar y crear proyectos que no existan
    const uniqueProyectos = Array.from(new Set(intervals.map((inv) => inv.proyecto)));
    for (const projCode of uniqueProyectos) {
      const proyectoExistente = await prisma.minuta_proyecto.findUnique({
        where: { code: projCode },
      });

      if (!proyectoExistente) {
        const proyectoRaw = await prisma.$queryRaw<{ nombre: string }[]>`
          SELECT nombre_proyecto AS nombre
          FROM briefing_2026
          WHERE cedula = ${projCode}
          LIMIT 1
        `;

        if (!proyectoRaw.length) {
          return { error: `El proyecto con cédula "${projCode}" no existe en el catálogo de proyectos` };
        }

        await prisma.minuta_proyecto.create({
          data: {
            code: projCode,
            nombre: proyectoRaw[0].nombre,
          },
        });
      }
    }

    // Guardar en la base de datos de manera atómica
    await prisma.$transaction(
      intervals.map((interval) => {
        const horaInicioDate = new Date(`1970-01-01T${interval.horaInicio}:00.000Z`);
        const horaFinDate = new Date(`1970-01-01T${interval.horaFin}:00.000Z`);
        
        return prisma.minuta_registro_actividad.create({
          data: {
            empleado: session.user.id,
            fecha: fechaDate,
            hora_inicio: horaInicioDate,
            hora_fin: horaFinDate,
            proyecto: interval.proyecto,
            actividad: interval.actividad,
            tipo_minuta: data.tipo,
            aprobado: data.tipo === "B" ? "PE" : "SI",
            observacion: interval.observacion,
          },
        });
      })
    );

    revalidatePath("/dashboard");
    revalidatePath("/admin");

    // Sincronizar en segundo plano
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      syncMinutasToSheets({ skipAuth: true }).catch((err) => {
        console.error("Error al actualizar Google Sheets en segundo plano:", err);
      });
    }

    return { success: true };

  } catch (error) {
    console.error("Error al registrar el tiempo:", error);
    return { error: "Error de servidor al registrar el tiempo" };
  }
}
