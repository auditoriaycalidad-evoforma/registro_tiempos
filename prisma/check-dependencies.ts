import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'

const prisma = new PrismaClient()
const filePath = 'C:/Users/Auditoría/Downloads/MAESTRO DE DATOS 2026.xlsx'

async function main() {
  // 1. Get referenced employee IDs
  const activeLogs = await prisma.minuta_registro_actividad.findMany({
    select: { empleado: true }
  })
  const referencedIds = Array.from(new Set(activeLogs.map(l => l.empleado)))
  console.log('IDs de empleados referenciados en actividades:', referencedIds)

  // 2. Load Excel IDs
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets['TIEMPOS']
  const rawData = XLSX.utils.sheet_to_json<any>(sheet)
  const excelIds = rawData.map(r => r.id?.toString().trim()).filter(Boolean)
  console.log(`IDs en Excel: ${excelIds.length}`)

  // 3. Find if any referenced ID is missing from the Excel file
  const missingIds = referencedIds.filter(id => !excelIds.includes(id))
  console.log('IDs referenciados que NO están en el Excel:', missingIds)

  // 4. Print columns A to G for rows where es_lider or área_lider is present
  const leaders = rawData.filter(r => r.es_lider || r.área_lider)
  console.log(`\nCantidad de filas con es_lider o área_lider en Excel: ${leaders.length}`)
  if (leaders.length > 0) {
    console.log('Ejemplo de filas con es_lider/área_lider:')
    console.log(JSON.stringify(leaders.slice(0, 5), null, 2))
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
