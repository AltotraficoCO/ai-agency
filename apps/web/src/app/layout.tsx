import type { Metadata, Viewport } from "next";
import { Fredoka, JetBrains_Mono, Nunito } from "next/font/google";
import { ThemeProvider, Toaster, TooltipProvider } from "@strappy/ui";
import "@strappy/ui/styles.css";
import "./globals.css";

// Plastilina: Nunito para leer y trabajar, Fredoka para los títulos. Las dos
// son redondas como los personajes, sin llegar a ser de juguete.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  display: "swap",
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Strappy · Agentes de IA para WhatsApp",
    template: "%s · Strappy",
  },
  description:
    "Crea agentes de inteligencia artificial que atienden tu WhatsApp, y toma el control cuando haga falta.",
  applicationName: "Strappy",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1C1730" },
    { media: "(prefers-color-scheme: light)", color: "#FBF6EE" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Sin clase `.dark`: el tema claro de plastilina es la base y next-themes añade el de noche.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${nunito.variable} ${fredoka.variable} ${jetbrainsMono.variable} h-full overflow-hidden`}
    >
      {/* El shell gestiona su propio desplazamiento: si el documento también
          desplaza, aparecen dos barras y el contenido se corta al final. */}
      <body className="flex h-full flex-col overflow-hidden">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
