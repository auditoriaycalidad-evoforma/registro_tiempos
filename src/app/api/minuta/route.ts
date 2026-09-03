import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAuthorizedAuditor } from "@/app/actions/minuta";
import { formatTime24 } from "@/lib/formatTime";
import { revalidatePath } from "next/cache";
import { syncMinutasToSheets } from "@/app/actions/exportar";

export const dynamic = "force-dynamic";

export interface MinutaInterval {
  proyecto: string;
  actividad: string;
  horaInicio: string;
  horaFin: string;
  observacion?: string;
}

export interface MinutaPayload {
  empleado?: string;
  fecha: string;
  tipo: string;
  intervals: MinutaInterval[];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado. Inicie sesión de nuevo." }, { status: 401 });
    }

    let body: MinutaPayload;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo de solicitud JSON inválido." }, { status: 400 });
    }

    const { empleado, fecha, tipo, intervals } = body;

    const isAuditor = await isAuthorizedAuditor(session);
    let targetEmpleadoId = session.user.id;

    if (empleado && empleado !== session.user.id) {
      if (!isAuditor) {
        return NextResponse.json(
          { error: "No autorizado. Solo los auditores autorizados pueden registrar tiempos de otros colaboradores." },
          { status: 403 }
        );
      }
      const targetEmpleado = await prisma.minuta_empleado.findUnique({
        where: { id: empleado },
      });
      if (!targetEmpleado || (targetEmpleado.activo && targetEmpleado.activo.toUpperCase() === "N")) {
        return NextResponse.json(
          { error: "El colaborador seleccionado no es válido o está inactivo." },
          { status: 400 }
        );
      }
      targetEmpleadoId = empleado;
    } else if (empleado) {
      targetEmpleadoId = empleado;
    }

    if (!fecha || !tipo) {
      return NextResponse.json(
        { error: "La fecha y el tipo de tiempo son obligatorios." },
        { status: 400 }
      );
    }

    if (!intervals || !Array.isArray(intervals) || intervals.length === 0) {
      return NextResponse.json(
        { error: "Debe registrar al menos un rango de tiempo." },
        { status: 400 }
      );
    }

    if (intervals.length > 7) {
      return NextResponse.json(
        { error: "No se permiten más de 7 rangos de tiempo." },
        { status: 400 }
      );
    }

    if (tipo !== "A" && tipo !== "O") {
      return NextResponse.json(
        { error: "Tipo de tiempo no permitido" },
        { status: 400 }
      );
    }

    // Validar que la fecha no sea inferior a dos días antes ni superior a dos días después del día en curso
    const hoy = new Date();
    const hoySoloFecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const limiteMinimo = new Date(hoySoloFecha);
    limiteMinimo.setDate(limiteMinimo.getDate() - 2);
    const limiteMaximo = new Date(hoySoloFecha);
    limiteMaximo.setDate(limiteMaximo.getDate() + 2);

    const [year, month, day] = fecha.split("-").map(Number);
    const fechaIngresada = new Date(year, month - 1, day);

    if (fechaIngresada < limiteMinimo || fechaIngresada > limiteMaximo) {
      return NextResponse.json(
        { error: "La fecha seleccionada no está permitida" },
        { status: 400 }
      );
    }

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

    // Validaciones de intervalos individuales
    for (let i = 0; i < intervals.length; i++) {
      const inv = intervals[i];
      if (!inv.horaInicio || !inv.horaFin || !inv.proyecto || !inv.actividad) {
        return NextResponse.json(
          { error: `Debe completar Cédula, Actividad y Horarios para el rango #${i + 1}.` },
          { status: 400 }
        );
      }

      const start = inv.horaInicio.trim();
      const end = inv.horaFin.trim();

      if (!timePattern.test(start) || !timePattern.test(end)) {
        return NextResponse.json(
          { error: `Formato de hora inválido en el rango #${i + 1}. Debe ser HH:MM.` },
          { status: 400 }
        );
      }

      if (end <= start) {
        return NextResponse.json(
          { error: `En el rango #${i + 1}, la hora de fin (${end}) debe ser posterior a la de inicio (${start}).` },
          { status: 400 }
        );
      }
    }

    // Validar solapamientos internos entre los nuevos intervalos
    for (let i = 0; i < intervals.length; i++) {
      const startI = timeToMinutes(intervals[i].horaInicio);
      const endI = timeToMinutes(intervals[i].horaFin);

      for (let j = i + 1; j < intervals.length; j++) {
        const startJ = timeToMinutes(intervals[j].horaInicio);
        const endJ = timeToMinutes(intervals[j].horaFin);

        if (startI < endJ && startJ < endI) {
          return NextResponse.json(
            { error: `Los rangos ingresados se solapan entre sí: ${intervals[i].horaInicio}-${intervals[i].horaFin} y ${intervals[j].horaInicio}-${intervals[j].horaFin}.` },
            { status: 400 }
          );
        }
      }
    }

    const fechaDate = new Date(`${fecha}T00:00:00.000Z`);

    // Validar solapamiento con registros existentes en la base de datos para este empleado en esta fecha
    const existing = await prisma.minuta_registro_actividad.findMany({
      where: {
        empleado: targetEmpleadoId,
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
          return NextResponse.json(
            { error: `El rango ${inv.horaInicio} - ${inv.horaFin} se solapa con un registro guardado en la base de datos (${recStartStr} - ${recEndStr}).` },
            { status: 400 }
          );
        }
      }
    }

    // Validar y crear proyectos inexistentes en catálogo local
    const uniqueProyectos = Array.from(new Set(intervals.map((inv) => inv.proyecto.trim())));
    for (const projCode of uniqueProyectos) {
      const proyectoExistente = await prisma.minuta_proyecto.findUnique({
        where: { code: projCode },
      });

      let nombreProyecto = proyectoExistente?.nombre;

      if (!proyectoExistente) {
        const proyectoRaw = await prisma.$queryRaw<{ nombre: string }[]>`
          SELECT COALESCE(nombre_proyecto, cedula) AS nombre
          FROM briefing_2026
          WHERE cedula = ${projCode}
          LIMIT 1
        `;

        if (!proyectoRaw.length || !proyectoRaw[0].nombre) {
          return NextResponse.json(
            { error: `El proyecto con cédula "${projCode}" no es válido. Debe seleccionar un proyecto válido de la base de datos.` },
            { status: 400 }
          );
        }

        nombreProyecto = proyectoRaw[0].nombre;

        await prisma.minuta_proyecto.create({
          data: {
            code: projCode,
            nombre: nombreProyecto,
          },
        });
      } else if (!nombreProyecto) {
        return NextResponse.json(
          { error: `El proyecto con cédula "${projCode}" no es válido. Debe seleccionar un proyecto válido de la base de datos.` },
          { status: 400 }
        );
      }
    }

    // Insertar registros en transacción atómica
    await prisma.$transaction(
      intervals.map((inv) => {
        const horaInicioDate = new Date(`1970-01-01T${inv.horaInicio.trim()}:00.000Z`);
        const horaFinDate = new Date(`1970-01-01T${inv.horaFin.trim()}:00.000Z`);

        return prisma.minuta_registro_actividad.create({
          data: {
            empleado: targetEmpleadoId,
            fecha: fechaDate,
            hora_inicio: horaInicioDate,
            hora_fin: horaFinDate,
            proyecto: inv.proyecto.trim(),
            actividad: inv.actividad.trim(),
            tipo_minuta: tipo,
            aprobado: tipo === "O" ? "PE" : "SI",
            observacion: inv.observacion?.trim() || "",
          },
        });
      })
    );

    revalidatePath("/dashboard");
    revalidatePath("/admin");
    revalidatePath("/pwa");

    // Sincronizar Google Sheets en segundo plano
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      syncMinutasToSheets({ skipAuth: true }).catch((err) => {
        console.error("Error al actualizar Google Sheets en segundo plano desde endpoint API:", err);
      });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Error en API /api/minuta:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al procesar el registro de tiempos." },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
    const userEmail = session.user.email?.toLowerCase();
    const isAdmin = userEmail && allowedEmails.includes(userEmail);
    if (!isAdmin) {
      return NextResponse.json({ history: [] }, { status: 200 });
    }

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

    return NextResponse.json({ history }, { status: 200 });
  } catch (error) {
    console.error("Error en GET /api/minuta:", error);
    return NextResponse.json({ error: "Error al obtener el historial" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let idStr = searchParams.get("id");
    if (!idStr) {
      const body = await request.json().catch(() => ({}));
      idStr = body?.id;
    }

    const id = parseInt(idStr || "", 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID de registro inválido" }, { status: 400 });
    }

    const record = await prisma.minuta_registro_actividad.findUnique({
      where: { id },
    });

    if (!record || record.empleado !== session.user.id) {
      return NextResponse.json({ error: "Registro no encontrado o no autorizado." }, { status: 404 });
    }

    const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
    const userEmail = session.user.email?.toLowerCase();
    const isSpecialUser = userEmail && allowedEmails.includes(userEmail);

    if (record.tipo_minuta === "O" && record.aprobado === "SI" && !isSpecialUser) {
      return NextResponse.json(
        { error: "No puedes eliminar un registro de horas extra que ya ha sido aprobado." },
        { status: 403 }
      );
    }

    await prisma.minuta_registro_actividad.delete({
      where: { id },
    });

    revalidatePath("/dashboard");
    revalidatePath("/admin");
    revalidatePath("/pwa");

    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      syncMinutasToSheets({ skipAuth: true }).catch((err) => {
        console.error("Error al actualizar Google Sheets en segundo plano tras eliminar:", err);
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error en DELETE /api/minuta:", error);
    return NextResponse.json({ error: "Error al eliminar el registro." }, { status: 500 });
  }
}

