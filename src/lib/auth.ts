import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Ingresa tu Email Corporativo", type: "email", placeholder: "tu@email.com" },
      },
      async authorize(credentials) {
        if (!credentials?.email) {
          throw new Error("Por favor ingresa un correo");
        }

        const empleado = await prisma.minuta_empleado.findUnique({
          where: {
            email: credentials.email,
          },
        });

        if (!empleado) {
          throw new Error("El empleado no se encuentra registrado en el sistema");
        }

        // Definir si es administrador (esto puede configurarse con variable de entorno)
        const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : ['admin@minutas.local'];
        const rol = adminEmails.includes(empleado.email!) ? "ADMIN" : "EMPLEADO";

        return {
          id: empleado.id,
          email: empleado.email,
          nombre: empleado.apellido_nombre,
          rol: rol,
        };
      },
    }),
  ],
  callbacks: {
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
