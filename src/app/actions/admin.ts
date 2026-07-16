"use server";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { syncMinutasToSheets } from "./exportar";

export async function approveMinuta(id: number, decision: "SI" | "RE") {
  const session = await getServerSession(authOptions);
  const canApprove = session?.user?.rol === "ADMIN" || session?.user?.rol === "LIDER";
  
  if (!canApprove) {
    return { error: "No autorizado" };
  }

  try {
    const record = await prisma.minuta_registro_actividad.findUnique({
      where: { id },
    });

    if (!record) {
      return { error: "Registro no encontrado" };
    }

    if (record.tipo_minuta !== "O") {
      return { error: "Solo se pueden aprobar tiempos de tipo O." };
    }

    const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
    const userEmail = session?.user?.email?.toLowerCase();
    const isSpecialUser = userEmail && allowedEmails.includes(userEmail);

    if (record.aprobado === "SI" && !isSpecialUser) {
      return { error: "No tiene permisos para modificar tiempos aprobados." };
    }

    await prisma.minuta_registro_actividad.update({
      where: { id },
      data: { aprobado: decision },
    });

    revalidatePath("/admin");

    // Sync to Google Sheets in background
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      syncMinutasToSheets({ skipAuth: true }).catch((err) => {
        console.error("Error updating Google Sheets in background:", err);
      });
    }

    return { success: true };
  } catch (error) {
    return { error: "Error de servidor al aprobar el registro de tiempo" };
  }
}

export async function cleanDatabaseRecords(beforeDate?: string) {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  
  if (userEmail !== "auditoriaycalidad@evoforma.net") {
    return { error: "No autorizado. Solo el administrador principal puede realizar esta acción." };
  }

  try {
    // 1. preventative sync of all records
    await syncMinutasToSheets({ skipAuth: true });

    // 2. build filter
    let whereClause = {};
    if (beforeDate) {
      whereClause = {
        fecha: {
          lt: new Date(`${beforeDate}T00:00:00.000Z`)
        }
      };
    }

    // 3. fetch records to delete
    const records = await prisma.minuta_registro_actividad.findMany({
      where: whereClause,
      select: { id: true }
    });
    const ids = records.map((r) => r.id);

    // 4. delete in transaction
    await prisma.$transaction([
      prisma.minuta_auditoria.deleteMany({
        where: {
          registro_id: { in: ids }
        }
      }),
      prisma.minuta_registro_actividad.deleteMany({
        where: {
          id: { in: ids }
        }
      })
    ]);

    revalidatePath("/admin");
    revalidatePath("/dashboard");
    revalidatePath("/pwa");

    return { success: true, count: ids.length };
  } catch (error) {
    console.error("Error clearing database records:", error);
    return { error: "Error de servidor al limpiar los registros de la aplicación." };
  }
}
