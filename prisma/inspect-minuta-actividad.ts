import * as XLSX from 'xlsx'

const filePath = 'C:/Users/Auditoría/Downloads/minuta_actividad.xlsx'

async function main() {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets['Hoja1']
  const excelData = XLSX.utils.sheet_to_json<any>(sheet)
  
  console.log('Filas con código indefinido u omitido:')
  excelData.forEach((row, i) => {
    if (row.code === undefined || row.code === null || row.code === '') {
      console.log(`Fila Excel índice ${i + 2}:`, row) // Excel is 1-indexed, headers are row 1, so data starts at row 2
    }
  })
}

main().catch(console.error)
