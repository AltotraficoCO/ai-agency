import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider, Toaster, TooltipProvider } from "@strappy/ui";
import "@strappy/ui/styles.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
    { media: "(prefers-color-scheme: dark)", color: "#0B0D12" },
    { media: "(prefers-color-scheme: light)", color: "#F4F5F8" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Sin clase `.light`: el tema oscuro es la base y next-themes añade la clara.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden`}
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
