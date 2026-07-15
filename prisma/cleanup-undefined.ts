import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const deleted = await prisma.minuta_actividad.deleteMany({
    where: { code: 'undefined' }
  })
  console.log(`Se eliminaron ${deleted.count} registros con código 'undefined'.`)
  
  const currentCount = await prisma.minuta_actividad.count()
  console.log(`Cantidad total de actividades en minuta_actividad después de la limpieza: ${currentCount}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
