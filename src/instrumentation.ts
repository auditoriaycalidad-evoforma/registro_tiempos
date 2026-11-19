export async function register() {
  // Ejecutar únicamente en el runtime Node.js del servidor (nunca en Edge ni en cliente)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { iniciarSchedulerHorarios } = await import("@/lib/scheduler");
    iniciarSchedulerHorarios();
  }
}
