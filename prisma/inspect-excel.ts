import * as XLSX from 'xlsx'

const filePath = 'C:/Users/Auditoría/Downloads/MAESTRO DE DATOS 2026.xlsx'

try {
  console.log('Cargando archivo Excel...')
  const workbook = XLSX.readFile(filePath)
  console.log('Hojas encontradas:', workbook.SheetNames)
  
  for (const sheetName of workbook.SheetNames) {
    console.log(`\n--- Inspeccionando hoja: ${sheetName} ---`)
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet)
    console.log(`Cantidad de filas: ${data.length}`)
    if (data.length > 0) {
      console.log('Ejemplo de las primeras 2 filas:')
      console.log(JSON.stringify(data.slice(0, 2), null, 2))
    }
  }
} catch (error) {
  console.error('Error al leer el archivo Excel:', error)
}
