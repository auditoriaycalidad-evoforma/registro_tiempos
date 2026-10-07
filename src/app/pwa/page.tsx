import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PwaContainer } from "./PwaContainer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Evoforma - Registro de Actividades",
  description: "Registro rápido de actividades (PWA)",
  manifest: "/manifest.json",
  appleWebAppCapable: "yes",
  appleWebAppStatusBarStyle: "default",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#E87C1E",
};

export default async function PwaPage() {
  const session = await getServerSession(authOptions);

  type ProyectoOption = {
    code: string;
    nombre: string;
  };

  // Cargar catálogos
  const proyectos = await prisma.$queryRaw<ProyectoOption[]>`
    SELECT DISTINCT
      cedula AS code,
      COALESCE(nombre_proyecto, cedula) AS nombre
    FROM briefing_2026
    WHERE cedula IS NOT NULL
    ORDER BY cedula ASC
  `;

  const actividades = await prisma.minuta_actividad.findMany({
    orderBy: { nombre: 'asc' }
  });

  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session?.user?.email?.toLowerCase()?.trim();
  const isAdmin = session?.user?.rol === "ADMIN" || !!(userEmail && allowedEmails.includes(userEmail));

  // Cargar empleado para validar si es líder
  const empleado = session?.user?.id || session?.user?.email
    ? await prisma.minuta_empleado.findFirst({
        where: {
          OR: [
            { id: session.user.id },
            { email: { equals: session.user.email ?? "", mode: "insensitive" } }
          ]
        }
      })
    : null;
  const esLiderN = empleado ? empleado.es_lider === "N" : session?.user?.rol === "EMPLEADO";

  // Cargar lista de empleados activos
  const empleados = await prisma.minuta_empleado.findMany({
    where: {
      OR: [
        { activo: null },
        { activo: { not: "N" } }
      ]
    },
    orderBy: { apellido_nombre: "asc" },
    select: {
      id: true,
      apellido_nombre: true,
      cargo: true,
    }
  });

  // Cargar registro de actividades para administración
  const minutas = (session?.user?.id && isAdmin)
    ? await prisma.minuta_registro_actividad.findMany({
        orderBy: [
          { fecha: 'desc' },
          { hora_inicio: 'desc' }
        ],
        include: {
          minuta_proyecto: true,
          minuta_actividad: true,
          minuta_empleado: true,
        }
      })
    : [];

  return (
    <PwaContainer
      proyectos={proyectos}
      actividades={actividades}
      empleados={empleados}
      minutas={minutas}
      session={session}
      isAdmin={isAdmin}
      esLiderN={esLiderN}
    />
  );
}
