import { NextResponse } from "next/server";
import { getVapidConfig } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getVapidConfig();
  return NextResponse.json({
    configured: cfg.configured,
    publicKey: cfg.configured ? cfg.publicKey : null,
  });
}
