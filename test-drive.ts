import { config } from "dotenv";
import crypto from "crypto";

config(); // Load environment variables from .env

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt(email: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: email,
      scope: SCOPES.join(" "),
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    })
  );
  const unsignedToken = `${header}.${claimSet}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsignedToken), privateKey.replace(/\\n/g, "\n"));

  return `${unsignedToken}.${base64Url(signature)}`;
}

async function requestAccessToken(email: string, privateKey: string) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createJwt(email, privateKey),
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google OAuth rechazó la autenticación (${response.status}): ${await response.text()}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

async function runTest() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const folderId = process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID;

  console.log("GOOGLE_SERVICE_ACCOUNT_EMAIL:", email);
  console.log("GOOGLE_DRIVE_EXPORT_FOLDER_ID:", folderId);
  console.log("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY exists:", !!privateKey);

  if (!email || !privateKey || !folderId) {
    console.error("Error: Faltan variables de entorno en el .env.");
    return;
  }

  try {
    console.log("Solicitando Access Token...");
    const token = await requestAccessToken(email, privateKey);
    console.log("Token obtenido correctamente.");

    console.log(`Buscando archivos en la carpeta '${folderId}'...`);
    const query = `'${folderId}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q: query,
      fields: "files(id,name,mimeType,webViewLink)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });

    const response = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await response.json() as any;

    if (!response.ok) {
      console.error("Error al consultar Drive API:", result);
      return;
    }

    console.log("Archivos encontrados:");
    if (result.files && result.files.length > 0) {
      result.files.forEach((file: any) => {
        console.log(`- Nombre: "${file.name}" | ID: ${file.id} | Tipo: ${file.mimeType}`);
      });
    } else {
      console.log("No se encontraron archivos en esta carpeta o la cuenta de servicio no tiene acceso a ellos.");
    }
  } catch (error) {
    console.error("Error durante la prueba:", error);
  }
}

runTest();
