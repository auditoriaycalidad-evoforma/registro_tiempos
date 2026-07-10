"use server";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { syncMinutasToSheets } from "./exportar";
import { formatTime24 } from "@/lib/formatTime";

// Interfaz para recibir los intervalos desde la PWA
export interface PwaInterval {
  proyecto: string;
  actividad: string;
  horaInicio: string;
  horaFin: string;
  observacion: string;
}

export async function createMinutasPwa(data: { fecha: string; tipo: string; intervals: PwaInterval[] }) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return { error: "No autorizado. Inicie sesión de nuevo." };
  }

  const { fecha, tipo, intervals } = data;

  if (!fecha || !tipo) {
    return { error: "La fecha y el tipo de tiempo son obligatorios." };
  }

  if (!intervals || intervals.length === 0) {
    return { error: "Debe registrar al menos un rango de tiempo." };
  }

  // Validar que la fecha no sea superior a dos días después del día en curso
  const hoy = new Date();
  const hoySoloFecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const limiteMaximo = new Date(hoySoloFecha);
  limiteMaximo.setDate(limiteMaximo.getDate() + 2);

  const [year, month, day] = fecha.split("-").map(Number);
  const fechaIngresada = new Date(year, month - 1, day);

  if (fechaIngresada > limiteMaximo) {
    return { error: "No es posible registrar tiempos para fechas posteriores a más de 2 días de la fecha actual." };
  }

  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  // Validaciones de intervalos individuales
  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv.horaInicio || !inv.horaFin || !inv.proyecto || !inv.actividad) {
      return { error: `Debe completar Cédula, Actividad y Horarios para el rango #${i + 1}.` };
    }

    const start = inv.horaInicio.trim();
    const end = inv.horaFin.trim();

    if (!timePattern.test(start) || !timePattern.test(end)) {
      return { error: `Formato de hora inválido en el rango #${i + 1}. Debe ser HH:MM.` };
    }

    if (end <= start) {
      return { error: `En el rango #${i + 1}, la hora de fin (${end}) debe ser posterior a la de inicio (${start}).` };
    }
  }

  // Convertir HH:MM a minutos
  function timeToMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  // Validar solapamientos internos entre los nuevos intervalos
  for (let i = 0; i < intervals.length; i++) {
    const startI = timeToMinutes(intervals[i].horaInicio);
    const endI = timeToMinutes(intervals[i].horaFin);

    for (let j = i + 1; j < intervals.length; j++) {
      const startJ = timeToMinutes(intervals[j].horaInicio);
      const endJ = timeToMinutes(intervals[j].horaFin);

      if (startI < endJ && startJ < endI) {
        return { 
          error: `Los rangos ingresados se solapan entre sí: ${intervals[i].horaInicio}-${intervals[i].horaFin} y ${intervals[j].horaInicio}-${intervals[j].horaFin}.` 
        };
      }
    }
  }

  try {
    const fechaDate = new Date(`${fecha}T00:00:00.000Z`);

    // Validar solapamiento con registros existentes en la base de datos para este empleado en esta fecha
    const existing = await prisma.minuta_registro_actividad.findMany({
      where: {
        empleado: session.user.id,
        fecha: fechaDate,
      },
    });

    for (const inv of intervals) {
      const startMin = timeToMinutes(inv.horaInicio);
      const endMin = timeToMinutes(inv.horaFin);

      for (const record of existing) {
        const recStartStr = formatTime24(record.hora_inicio);
        const recEndStr = formatTime24(record.hora_fin);
        const recStartMin = timeToMinutes(recStartStr);
        const recEndMin = timeToMinutes(recEndStr);

        if (startMin < recEndMin && recStartMin < endMin) {
          return {
            error: `El rango ${inv.horaInicio} - ${inv.horaFin} se solapa con un registro guardado en la base de datos (${recStartStr} - ${recEndStr}).`
          };
        }
      }
    }

    // Validar y crear proyectos inexistentes en catálogo local
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
          return { error: `La cédula de proyecto "${projCode}" no existe en el catálogo de proyectos.` };
        }

        await prisma.minuta_proyecto.create({
          data: {
            code: projCode,
            nombre: proyectoRaw[0].nombre,
          },
        });
      }
    }

    // Insertar registros en transacción atómica
    await prisma.$transaction(
      intervals.map((inv) => {
        const horaInicioDate = new Date(`1970-01-01T${inv.horaInicio}:00.000Z`);
        const horaFinDate = new Date(`1970-01-01T${inv.horaFin}:00.000Z`);

        return prisma.minuta_registro_actividad.create({
          data: {
            empleado: session.user.id,
            fecha: fechaDate,
            hora_inicio: horaInicioDate,
            hora_fin: horaFinDate,
            proyecto: inv.proyecto,
            actividad: inv.actividad,
            tipo_minuta: tipo,
            aprobado: tipo === "B" ? "PE" : "SI",
            observacion: inv.observacion,
          },
        });
      })
    );

    revalidatePath("/dashboard");
    revalidatePath("/admin");
    revalidatePath("/pwa");

    // Sincronizar Google Sheets en segundo plano si está configurado
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      syncMinutasToSheets({ skipAuth: true }).catch((err) => {
        console.error("Error al actualizar Google Sheets en segundo plano desde PWA:", err);
      });
    }

    return { success: true };

  } catch (error) {
    console.error("Error al registrar tiempo desde PWA:", error);
    return { error: "Error interno al guardar los registros." };
  }
}

export async function getPwaHistory() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { error: "No autorizado" };
  }

  try {
    const history = await prisma.minuta_registro_actividad.findMany({
      where: {
        empleado: session.user.id,
      },
      orderBy: [
        { fecha: "desc" },
        { hora_inicio: "desc" },
      ],
      include: {
        minuta_proyecto: true,
        minuta_actividad: true,
      },
      take: 50,
    });

    return { history };
  } catch (error) {
    console.error("Error al obtener historial PWA:", error);
    return { error: "Error al obtener el historial" };
  }
}

export async function deleteMinutaPwa(id: number) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { error: "No autorizado" };
  }

  try {
    const record = await prisma.minuta_registro_actividad.findUnique({
      where: { id },
    });

    if (!record || record.empleado !== session.user.id) {
      return { error: "Registro no encontrado o no autorizado." };
    }

    // Bloquear eliminación si es horas extra B y ya está aprobado
    if (record.tipo_minuta === "B" && record.aprobado === "SI") {
      return { error: "No puedes eliminar un registro de horas extra que ya ha sido aprobado." };
    }

    await prisma.minuta_registro_actividad.delete({
      where: { id },
    });

    revalidatePath("/dashboard");
    revalidatePath("/admin");
    revalidatePath("/pwa");

    // Sincronizar Google Sheets
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      syncMinutasToSheets({ skipAuth: true }).catch((err) => {
        console.error("Error al actualizar Google Sheets en segundo plano tras eliminar:", err);
      });
    }

    return { success: true };
  } catch (error) {
    console.error("Error al eliminar registro PWA:", error);
    return { error: "Error al eliminar el registro." };
  }
}
