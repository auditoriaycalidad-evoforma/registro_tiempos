# Minutas - Guía de Inicio Rápido en Windows

Este proyecto es una aplicación web construida con Next.js y Prisma. Sigue estos pasos para configurarla y ejecutarla en tu entorno Windows.

## 🛠️ Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:
1. **Node.js** (versión 18 o superior). Puedes descargarlo desde [nodejs.org](https://nodejs.org/).
2. **PostgreSQL** (o acceso a una base de datos PostgreSQL en red).

---

## 🚀 Pasos para la Configuración

### 1. Instalación de Dependencias

Si utilizas **PowerShell** en Windows, la ejecución de scripts `.ps1` suele estar deshabilitada por defecto, lo que puede provocar un error al ejecutar `npm`.

Tienes dos formas de solucionarlo para instalar las dependencias:

* **Opción A (Recomendada):** Llama directamente al ejecutable nativo de Windows:
  ```bash
  npm.cmd install
  ```
* **Opción B:** Ejecuta el comando en una terminal de **CMD** (Símbolo del sistema) estándar:
  ```cmd
  npm install
  ```
* **Opción C:** Habilita temporalmente la ejecución de scripts en tu sesión de PowerShell:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
  npm install
  ```

---

### 2. Configurar el Archivo de Entorno (`.env`)

Crea o edita el archivo `.env` en la raíz del proyecto y asegúrate de que contenga todas las variables necesarias. Puedes usar esta plantilla básica:

```env
# URL de la base de datos PostgreSQL
DATABASE_URL="postgresql://usuario:contraseña@servidor:puerto/base_datos?schema=public"

# Secreto para la sesión de NextAuth (cualquier clave segura)
NEXTAUTH_SECRET="minutas-development-super-secret-key-12345"
NEXTAUTH_URL="http://localhost:3000"

# Credenciales de Google Auth (Cliente de login)
GOOGLE_CLIENT_ID="tu-google-client-id"
GOOGLE_CLIENT_SECRET="tu-google-client-secret"

# Cuenta de Servicio para Exportación (Google Drive / Sheets)
GOOGLE_SERVICE_ACCOUNT_EMAIL="minutas-exporter@macros-evoforma.iam.gserviceaccount.com"
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
GOOGLE_DRIVE_EXPORT_FOLDER_ID="1HTK2XHTteV5w-zgBYasP7vYfmQ5DCn7G"
GOOGLE_SPREADSHEET_ID="15XoQ99EuKMrW_hKT-90OkZVo5yVXlKMGBwlOTsNM8VQ"

# Clave secreta para el cron de exportación diaria
EXPORT_CRON_SECRET="clave-secreta-para-el-cron"

# Administradores con acceso total (separados por comas)
ADMIN_EMAILS="auditoriaycalidad@evoforma.net"
```

---

### 3. Generar el Cliente de Prisma

Prisma requiere compilar sus esquemas para mapear la base de datos con TypeScript/JavaScript. Ejecuta:

```bash
npx.cmd prisma generate
```
*(O simplemente `npx prisma generate` si usas CMD).*

---

### 4. Iniciar el Servidor de Desarrollo

Una vez instaladas las dependencias y configurada la base de datos, inicia la aplicación de manera local con:

```bash
npm.cmd run dev
```
*(O `npm run dev` si estás usando CMD).*

La aplicación se compilará y estará disponible en tu navegador en:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📄 Notas Adicionales para Windows

* Si haces cambios en el esquema de la base de datos (`prisma/schema.prisma`), recuerda regenerar el cliente ejecutando de nuevo:
  ```bash
  npx.cmd prisma generate
  ```
* El servidor de desarrollo Next.js cuenta con recarga en caliente (*hot-reload*), por lo que cualquier cambio que realices en el código se reflejará automáticamente en el navegador sin necesidad de reiniciar la consola.
