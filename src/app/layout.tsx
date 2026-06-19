import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import Navbar from "@/components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Evoforma - Tiempos",
  description: "Gestión de Tiempos de Actividades",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${inter.className} bg-slate-50 min-h-screen`}>
        <Providers>
          <Navbar />
          <main className="w-full max-w-[96rem] mx-auto px-3 sm:px-5 lg:px-8 2xl:px-10 py-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
