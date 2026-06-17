import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    const canApprove = token?.rol === "ADMIN" || token?.rol === "LIDER";

    // Si intenta acceder a rutas de aprobacion sin permisos
    if (req.nextUrl.pathname.startsWith("/admin") && !canApprove) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
