import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const employees = await prisma.minuta_empleado.findMany({
    take: 5
  })
  console.log('Registros actuales de minuta_empleado (primeros 5):')
  console.log(JSON.stringify(employees, null, 2))
  
  const count = await prisma.minuta_empleado.count()
  console.log(`\nCantidad total de empleados: ${count}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
