import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const getRoleForEmployee = (email: string | null | undefined, esLider: string | null | undefined) => {
  const adminEmails = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map((adminEmail) => adminEmail.trim().toLowerCase())
    : ["admin@minutas.local"];

  if (email && adminEmails.includes(email.toLowerCase())) return "ADMIN";
  if (esLider?.toUpperCase() === "S") return "LIDER";

  return "EMPLEADO";
};

const isEmpleadoActivo = (activo: string | null | undefined) =>
  !activo || activo.toUpperCase() !== "N";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Usuario y contraseña",
      credentials: {
        username: { label: "Usuario", type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username?.trim();
        const password = credentials?.password;
        if (!username || !password) return null;

        const empleado = await prisma.minuta_empleado.findFirst({
          where: {
            username: {
              equals: username,
              mode: "insensitive",
            },
          },
        });

        if (!empleado?.password_hash) return null;
        if (!isEmpleadoActivo(empleado.activo)) return null;

        const valid = await verifyPassword(password, empleado.password_hash);
        if (!valid) return null;

        return {
          id: empleado.id,
          email: empleado.email,
          name: empleado.apellido_nombre,
          rol: getRoleForEmployee(empleado.email, empleado.es_lider),
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // El proveedor de credenciales ya valida usuario/contraseña en authorize().
      if (account?.provider === "credentials") return true;

      if (account?.provider !== "google") return false;
      if (!user.email) return false;

      const googleProfile = profile as { email_verified?: boolean } | undefined;
      if (googleProfile?.email_verified === false) return false;

      const empleado = await prisma.minuta_empleado.findFirst({
        where: {
          email: {
            equals: user.email,
            mode: "insensitive",
          },
        },
      });

      if (!empleado?.email) return false;
      if (!isEmpleadoActivo(empleado.activo)) return false;

      user.id = empleado.id;
      user.email = empleado.email;
      user.name = empleado.apellido_nombre;
      user.rol = getRoleForEmployee(empleado.email, empleado.es_lider);

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.rol = user.rol;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.rol = token.rol as string;
      }
      return session;
    },
  },
};
