import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'

const prisma = new PrismaClient()
const filePath = 'C:/Users/Auditoría/Downloads/minuta_actividad.xlsx'

const mapping: { [key: string]: string } = {
  'bodeg_mob': '101',
  'mont_prod': '103',
  'constr_prod': '104',
  'carg_tecn': '108',
  'carg_prod': '108',
  'carg_plan': '108',
  'carg_mob': '108',
  'alist_tecn': '115',
  'alist_prod': '115',
  'asis_tecn': '116'
}

async function main() {
  console.log('1. Cargando y procesando archivo Excel...')
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets['Hoja1']
  const excelData = XLSX.utils.sheet_to_json<any>(sheet)

  const newActivities = excelData.map(r => ({
    code: String(r.code).trim(),
    nombre: String(r.nombre).toUpperCase().trim(),
    area: r.area ? String(r.area).toUpperCase().trim() : null,
    descripcion: null
  }))

  const excelCodes = newActivities.map(a => a.code)
  console.log(`Se encontraron ${newActivities.length} actividades en el archivo Excel.`)

  console.log('2. Iniciando transacción en la base de datos...')
  await prisma.$transaction(async (tx) => {
    // A. Insertar todas las nuevas actividades de golpe usando createMany con skipDuplicates
    console.log('A. Insertando actividades del archivo Excel usando createMany...');
    const insertResult = await tx.minuta_actividad.createMany({
      data: newActivities,
      skipDuplicates: true
    })
    console.log(`   - Se insertaron ${insertResult.count} nuevas actividades (omitiendo duplicados si los hubiera).`)

    // B. Actualizar referencias en minuta_registro_actividad
    console.log('B. Actualizando referencias en minuta_registro_actividad...');
    for (const [oldCode, newCode] of Object.entries(mapping)) {
      const updateResult = await tx.minuta_registro_actividad.updateMany({
        where: { actividad: oldCode },
        data: { actividad: newCode }
      })
      if (updateResult.count > 0) {
        console.log(`   - Mapeado '${oldCode}' a '${newCode}': ${updateResult.count} registros actualizados.`)
      }
    }

    // C. Eliminar actividades antiguas que no están en el Excel
    console.log('C. Eliminando actividades que no están en el nuevo listado...');
    const deleteResult = await tx.minuta_actividad.deleteMany({
      where: {
        code: { notIn: excelCodes }
      }
    })
    console.log(`   - Se eliminaron ${deleteResult.count} actividades antiguas.`)
  }, {
    timeout: 30000 // 30 segundos
  })

  console.log('¡Actualización completada de manera exitosa!')
}

main()
  .catch(error => {
    console.error('Error durante la actualización:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
