"use server";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function createMinuta(formData: FormData) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return { error: "No autorizado" };
  }

  const data = {
    fecha: formData.get("fecha") as string,
    horaInicio: formData.get("horaInicio") as string,
    horaFin: formData.get("horaFin") as string,
    proyecto: formData.get("proyecto") as string,
    actividad: formData.get("actividad") as string,
    tipo: formData.get("tipo") as string, // "A" o "B"
  };

  // Validaciones básicas
  if (!data.fecha || !data.horaInicio || !data.horaFin || !data.proyecto || !data.actividad || !data.tipo) {
    return { error: "Todos los campos son obligatorios" };
  }

  if (data.horaFin <= data.horaInicio) {
    return { error: "La hora de fin debe ser posterior a la hora de inicio" };
  }

  try {
    // Formatear fechas para Prisma
    const fechaDate = new Date(`${data.fecha}T00:00:00.000Z`);
    
    // Parsear Franja Militar (ej: "0830") a HH:mm
    const inicioStr = data.horaInicio.slice(0, 2) + ":" + data.horaInicio.slice(2);
    const finStr = data.horaFin.slice(0, 2) + ":" + data.horaFin.slice(2);

    const horaInicioDate = new Date(`1970-01-01T${inicioStr}:00.000Z`);
    const horaFinDate = new Date(`1970-01-01T${finStr}:00.000Z`);

    // Validar solapamiento
    const solapamientos = await prisma.minuta_registro_actividad.findMany({
      where: {
        empleado: session.user.id,
        fecha: fechaDate,
        NOT: {
          OR: [
            { hora_fin: { lte: horaInicioDate } },
            { hora_inicio: { gte: horaFinDate } },
          ],
        },
      },
    });

    if (solapamientos.length > 0) {
      return { error: "Ya existe una actividad registrada en este rango de horas" };
    }

    await prisma.minuta_registro_actividad.create({
      data: {
        empleado: session.user.id,
        fecha: fechaDate,
        hora_inicio: horaInicioDate,
        hora_fin: horaFinDate,
        proyecto: data.proyecto,
        actividad: data.actividad,
        tipo_minuta: data.tipo,
        // Si es tipo B, lo dejamos en "NO" (equivalente a pendiente de aprobacion segun tu lógica existente). Si es A, en "SI" (validado) o N/A. Depende del acuerdo. Lo dejaremos general.
        aprobado: data.tipo === "B" ? "PE" : "SI", // PE: Pendiente
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/admin");
    return { success: true };

  } catch (error) {
    console.error("Error creating minuta:", error);
    return { error: "Error interno registrando la minuta" };
  }
}
