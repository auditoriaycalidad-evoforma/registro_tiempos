import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Asigna (o actualiza) el usuario y la contraseña de un empleado para el login
 * por credenciales.
 *
 * Uso:
 *   npx tsx prisma/set-password.ts <email-o-id-del-empleado> <username> <contraseña>
 *
 * Ejemplos:
 *   npx tsx prisma/set-password.ts juan.perez@evoforma.net jperez "ClaveSegura123"
 *   npx tsx prisma/set-password.ts EMP-0042 jperez "ClaveSegura123"
 */

const prisma = new PrismaClient();

async function main() {
  const [identifier, username, password] = process.argv.slice(2);

  if (!identifier || !username || !password) {
    console.error(
      "Uso: npx tsx prisma/set-password.ts <email-o-id> <username> <contraseña>"
    );
    process.exit(1);
  }

  const empleado = await prisma.minuta_empleado.findFirst({
    where: {
      OR: [
        { id: identifier },
        { email: { equals: identifier, mode: "insensitive" } },
      ],
    },
  });

  if (!empleado) {
    console.error(`No se encontró ningún empleado con id/email "${identifier}".`);
    process.exit(1);
  }

  const duplicado = await prisma.minuta_empleado.findFirst({
    where: {
      username: { equals: username, mode: "insensitive" },
      NOT: { id: empleado.id },
    },
  });

  if (duplicado) {
    console.error(
      `El username "${username}" ya está en uso por ${duplicado.apellido_nombre} (${duplicado.id}).`
    );
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 10);

  await prisma.minuta_empleado.update({
    where: { id: empleado.id },
    data: { username, password_hash },
  });

  console.log(
    `Credenciales actualizadas para ${empleado.apellido_nombre} (${empleado.id}).`
  );
  console.log(`  username: ${username}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
