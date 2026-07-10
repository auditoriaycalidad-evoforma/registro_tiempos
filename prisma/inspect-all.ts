import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'

const prisma = new PrismaClient()
const filePath = 'C:/Users/Auditoría/Downloads/MAESTRO DE DATOS 2026.xlsx'

async function main() {
  // 1. Inspect Excel Columns A to G
  console.log('--- INSPECCIÓN DE EXCEL ---')
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets['TIEMPOS']
  
  // Convert sheet to array of arrays to see exact columns A to G
  const rawData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 })
  if (rawData.length > 0) {
    const headers = rawData[0];
    console.log('Fila de cabeceras en Excel (columnas A a G/H):')
    console.log(headers.slice(0, 10))
    console.log('\nPrimeras 3 filas de datos completas:')
    console.log(JSON.stringify(rawData.slice(1, 4), null, 2))
  }

  // 2. Inspect Database Relations
  console.log('\n--- INSPECCIÓN DE BASE DE DATOS ---')
  const employeeCount = await prisma.minuta_empleado.count()
  const activityCount = await prisma.minuta_registro_actividad.count()
  console.log(`Cantidad actual de empleados en minuta_empleado: ${employeeCount}`)
  console.log(`Cantidad actual de registros en minuta_registro_actividad: ${activityCount}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
