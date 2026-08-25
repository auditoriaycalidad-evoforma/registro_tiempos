import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- Inspecting minuta_proyecto ---');
  const allProyectos = await prisma.minuta_proyecto.findMany({
    orderBy: { code: 'asc' }
  });
  console.log('All projects in local DB:', JSON.stringify(allProyectos, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
