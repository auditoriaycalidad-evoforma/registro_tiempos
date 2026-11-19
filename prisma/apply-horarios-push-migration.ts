import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sqlPath = path.join(__dirname, "migrations_horarios_push.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  // Ejecutar cada bloque/sentencia respetando bloques DO $$ ... $$;
  const statements: string[] = [];
  let current = "";
  let inDollarBlock = false;

  for (const rawLine of sql.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!inDollarBlock && (trimmed === "" || trimmed.startsWith("--"))) {
      continue;
    }
    if (!inDollarBlock && (trimmed.toUpperCase() === "BEGIN;" || trimmed.toUpperCase() === "COMMIT;")) {
      continue;
    }

    current += rawLine + "\n";

    const dollarMatches = rawLine.match(/\$\$/g);
    if (dollarMatches && dollarMatches.length % 2 === 1) {
      inDollarBlock = !inDollarBlock;
    }

    if (!inDollarBlock && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  console.log(`Aplicando ${statements.length} sentencias SQL aditivas...`);
  for (let i = 0; i < statements.length; i++) {
    await prisma.$executeRawUnsafe(statements[i]);
    console.log(`  [${i + 1}/${statements.length}] OK`);
  }

  console.log("Migración aditiva aplicada correctamente (public.horarios y registros históricos intactos).");
}

main()
  .catch((err) => {
    console.error("Error aplicando migración:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
