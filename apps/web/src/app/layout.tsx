import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider, Toaster, TooltipProvider } from "@strappy/ui";
import "@strappy/ui/styles.css";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
    { media: "(prefers-color-scheme: dark)", color: "#0D0D0D" },
    { media: "(prefers-color-scheme: light)", color: "#FAFAFA" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Sin clase `.light`: el tema oscuro es la base y next-themes añade la clara.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${plexSans.variable} ${jetbrainsMono.variable} h-full overflow-hidden`}
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
