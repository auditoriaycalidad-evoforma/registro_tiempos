import crypto from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

type DriveFileResponse = {
  id: string;
  name: string;
  webViewLink?: string;
};

type DriveListResponse = {
  files?: DriveFileResponse[];
};

type GoogleConfig = {
  clientEmail: string;
  privateKey: string;
  folderId: string;
};

export type SpreadsheetFile = {
  id: string;
  name: string;
  url: string;
};

function getGoogleConfig(): GoogleConfig {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const folderId = process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID ?? "1HTK2XHTteV5w-zgBYasP7vYfmQ5DCn7G";

  if (!clientEmail || !rawPrivateKey) {
    throw new Error(
      "Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY en el entorno."
    );
  }

  return {
    clientEmail,
    privateKey: rawPrivateKey.replace(/\\n/g, "\n"),
    folderId,
  };
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt(config: GoogleConfig) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPES.join(" "),
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    })
  );
  const unsignedToken = `${header}.${claimSet}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsignedToken), config.privateKey);

  return `${unsignedToken}.${base64Url(signature)}`;
}

async function requestAccessToken(config: GoogleConfig) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createJwt(config),
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google OAuth rechazó la autenticación (${response.status}).`);
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function googleFetch<T>(url: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google API respondió ${response.status}: ${details}`);
  }

  return (await response.json()) as T;
}

export async function getOrCreateSpreadsheet(fileName: string): Promise<SpreadsheetFile> {
  const config = getGoogleConfig();
  const accessToken = await requestAccessToken(config);
  const query = [
    `'${escapeDriveQueryValue(config.folderId)}' in parents`,
    `name = '${escapeDriveQueryValue(fileName)}'`,
    `mimeType = '${SPREADSHEET_MIME_TYPE}'`,
    "trashed = false",
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,webViewLink)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const existing = await googleFetch<DriveListResponse>(
    `${DRIVE_FILES_URL}?${params.toString()}`,
    accessToken
  );
  const file = existing.files?.[0];

  if (file) {
    return {
      id: file.id,
      name: file.name,
      url: file.webViewLink ?? `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
    };
  }

  const created = await googleFetch<DriveFileResponse>(
    `${DRIVE_FILES_URL}?fields=id,name,webViewLink&supportsAllDrives=true`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        name: fileName,
        mimeType: SPREADSHEET_MIME_TYPE,
        parents: [config.folderId],
      }),
    }
  );

  return {
    id: created.id,
    name: created.name,
    url: created.webViewLink ?? `https://docs.google.com/spreadsheets/d/${created.id}/edit`,
  };
}
export async function replaceSpreadsheetValues(
  spreadsheetId: string,
  values: (string | number)[][]
) {
  const config = getGoogleConfig();
  const accessToken = await requestAccessToken(config);

  await googleFetch(
    `${SHEETS_URL}/${spreadsheetId}/values/A%3AZ:clear`,
    accessToken,
    { method: "POST", body: JSON.stringify({}) }
  );

  await googleFetch(
    `${SHEETS_URL}/${spreadsheetId}/values/A1%3AZ${Math.max(values.length, 1)}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: "PUT",
      body: JSON.stringify({ range: "A1:Z", majorDimension: "ROWS", values }),
    }
  );
}
export async function ensureSheetExists(spreadsheetId: string, sheetTitle: string) {
  const config = getGoogleConfig();
  const accessToken = await requestAccessToken(config);

  const metadata = await googleFetch<{ sheets?: { properties: { title: string } }[] }>(
    `${SHEETS_URL}/${spreadsheetId}?fields=sheets.properties(title)`,
    accessToken
  );

  const sheetTitles = metadata.sheets?.map((s) => s.properties.title) ?? [];

  if (!sheetTitles.includes(sheetTitle)) {
    await googleFetch(
      `${SHEETS_URL}/${spreadsheetId}:batchUpdate`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetTitle,
                },
              },
            },
          ],
        }),
      }
    );
  }
}

export async function replaceSheetValues(
  spreadsheetId: string,
  sheetTitle: string,
  values: (string | number)[][]
) {
  const config = getGoogleConfig();
  const accessToken = await requestAccessToken(config);

  const range = `'${sheetTitle}'!A:Z`;
  const encodedRange = encodeURIComponent(range);

  await googleFetch(
    `${SHEETS_URL}/${spreadsheetId}/values/${encodedRange}:clear`,
    accessToken,
    { method: "POST", body: JSON.stringify({}) }
  );

  const updateRange = `'${sheetTitle}'!A1:Z${Math.max(values.length, 1)}`;
  const encodedUpdateRange = encodeURIComponent(updateRange);

  await googleFetch(
    `${SHEETS_URL}/${spreadsheetId}/values/${encodedUpdateRange}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: "PUT",
      body: JSON.stringify({
        range: updateRange,
        majorDimension: "ROWS",
        values,
      }),
    }
  );
}

