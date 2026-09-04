"use server";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { revalidatePath } from "next/cache";

const ADMIN_EMAILS = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  const isAdmin = session?.user?.rol === "ADMIN" || (!!email && ADMIN_EMAILS.includes(email));
  return isAdmin ? session : null;
}

type Result = { success: true } | { error: string };

/**
 * Asigna o actualiza el usuario y/o la contraseña de un empleado para el login
 * por credenciales. Pensado para llamarse desde una pantalla del panel de
 * administración.
 */
export async function setEmpleadoCredentials(input: {
  empleadoId: string;
  username?: string;
  password?: string;
}): Promise<Result> {
  const session = await requireAdmin();
  if (!session) return { error: "No autorizado." };

  const empleadoId = input.empleadoId?.trim();
  const username = input.username?.trim();
  const password = input.password;

  if (!empleadoId) return { error: "Falta el empleado." };
  if (!username && !password) return { error: "Indica un usuario o una contraseña." };
  if (password && password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  const empleado = await prisma.minuta_empleado.findUnique({ where: { id: empleadoId } });
  if (!empleado) return { error: "Empleado no encontrado." };

  if (username) {
    const duplicado = await prisma.minuta_empleado.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
        NOT: { id: empleadoId },
      },
    });
    if (duplicado) return { error: `El usuario "${username}" ya está en uso.` };
  }

  try {
    await prisma.minuta_empleado.update({
      where: { id: empleadoId },
      data: {
        ...(username ? { username } : {}),
        ...(password ? { password_hash: await hashPassword(password) } : {}),
      },
    });

    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("Error al actualizar credenciales:", error);
    return { error: "Error de servidor al actualizar las credenciales." };
  }
}

/** Elimina el acceso por usuario/contraseña de un empleado (sigue pudiendo entrar con Google). */
export async function clearEmpleadoCredentials(empleadoId: string): Promise<Result> {
  const session = await requireAdmin();
  if (!session) return { error: "No autorizado." };

  try {
    await prisma.minuta_empleado.update({
      where: { id: empleadoId.trim() },
      data: { username: null, password_hash: null },
    });
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("Error al limpiar credenciales:", error);
    return { error: "Error de servidor al limpiar las credenciales." };
  }
}
