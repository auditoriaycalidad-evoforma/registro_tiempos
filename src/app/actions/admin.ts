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
