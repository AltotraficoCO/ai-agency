import type { Metadata } from "next";
import { Gochi_Hand } from "next/font/google";
import { Landing } from "@/components/landing/landing";
import "@/components/landing/landing.css";

/**
 * La landing pública: la portada de strappy.io para todos, con sesión o sin
 * ella. La app empieza en `/app`.
 */

// La letra de las anotaciones: rotulador de pizarra, no la caligrafía de boda
// que delata a las landings hechas en serie.
const mano = Gochi_Hand({ weight: "400", subsets: ["latin"], variable: "--font-mano", display: "swap" });

export const metadata: Metadata = {
  title: { absolute: "Strappy · Tu agencia de IA" },
  description:
    "Contrata un equipo de agentes de IA que contesta tu WhatsApp, vigila tus anuncios, cuida tu web y lleva tus cuentas. Ellos hacen; tú das el visto bueno.",
  openGraph: {
    title: "Strappy · Tu equipo nuevo empieza el lunes",
    description: "Agentes de IA por departamento: Comunicaciones, Marketing, Desarrollo y Financiero.",
    url: "https://www.strappy.io",
    siteName: "Strappy",
    locale: "es_CO",
    type: "website",
  },
};

export default function PaginaConoce() {
  return <Landing claseFuentes={mano.variable} />;
}
