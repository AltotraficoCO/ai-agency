import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { Composer } from "../src/components/bandeja/composer";
import type { Catalogos, EstadoMando, Hilo, Restriccion } from "../src/lib/bandeja/tipos";

/**
 * Lo sutil de esta pantalla, que es justo lo que se rompe sin que nadie lo note:
 *
 *  · el composer se BLOQUEA mientras la IA atiende, y dice por qué;
 *  · la restricción del canal se muestra LITERAL, sin reinterpretarla;
 *  · escribir al cliente y anotar por dentro son dos caminos distintos.
 */

const CATALOGOS: Catalogos = {
  etiquetas: [],
  miembros: [{ id: "u1", nombre: "Ana Restrepo" }],
  respuestas: [{ id: "r1", atajo: "horario", titulo: "Horario", cuerpo: "Hola {{contacto.nombre}}" }],
  canales: [{ id: "c1", tipo: "whatsapp", nombre: "WhatsApp" }],
  agentes: [{ id: "a1", nombre: "Espiga" }],
  yo: { id: "u1", nombre: "Ana Restrepo" },
  hayCanal: true,
};

function hiloDe(mando: EstadoMando, restriccion: Restriccion | null = null): Hilo {
  return {
    conversacion: {
      id: "conv-1",
      contacto: { id: "ct1", nombre: "Marcela Ríos", telefono: "573001112233" },
      canal: { id: "c1", tipo: "whatsapp", nombre: "WhatsApp" },
      agente: { id: "a1", nombre: "Espiga" },
      asignado: null,
      mando,
      estado: "open",
      sinLeer: 0,
      etiquetas: [],
      ultimo: null,
      ultimaFecha: null,
      ultimoEntrante: null,
      ultimoSaliente: null,
      pospuestaHasta: null,
      envioLibreHasta: null,
      urgente: false,
    },
    elementos: [],
    control: { desde: null, quien: null },
    envio: { permitido: restriccion === null, restriccion },
    resumen: null,
    contacto: {
      id: "ct1",
      nombre: "Marcela Ríos",
      telefono: "573001112233",
      creadoEl: new Date("2026-01-01T12:00:00Z").toISOString(),
      propiedades: {},
    },
  };
}

/**
 * ¿Está el `<textarea>` deshabilitado?
 *
 * Se mira el atributo del propio `<textarea>` y no la palabra «disabled» en el
 * HTML: las clases de Tailwind (`disabled:opacity-60`) la contienen siempre.
 */
function areaBloqueada(html: string): boolean {
  const inicio = html.indexOf("<textarea");
  const etiqueta = html.slice(inicio, html.indexOf(">", inicio) + 1);
  return etiqueta.includes('disabled=""');
}

function pintar(hilo: Hilo): string {
  const ref = React.createRef<HTMLTextAreaElement>();
  return renderToStaticMarkup(
    <Composer
      hilo={hilo}
      catalogos={CATALOGOS}
      enviando={false}
      refTextarea={ref}
      alEnviar={() => undefined}
      alAnotar={() => undefined}
      alTomarControl={() => undefined}
    />,
  );
}

describe("composer · el mando", () => {
  it("se bloquea y explica por qué cuando la IA está atendiendo", () => {
    const html = pintar(hiloDe("ia"));
    expect(areaBloqueada(html)).toBe(true);
    expect(html).toContain("La IA está atendiendo esta conversación.");
    // Un composer muerto sin salida es el peor estado de esta pantalla.
    expect(html).toContain("Tomar el control");
  });

  it("se bloquea cuando el control lo tiene otra persona", () => {
    const html = pintar(hiloDe("otro"));
    expect(areaBloqueada(html)).toBe(true);
    expect(html).toContain("tiene el control");
  });

  it("queda activo cuando el control es tuyo y el canal deja escribir", () => {
    const html = pintar(hiloDe("tuyo"));
    expect(areaBloqueada(html)).toBe(false);
    expect(html).toContain("Escribe tu respuesta");
  });
});

describe("composer · la restricción del canal", () => {
  const RESTRICCION: Restriccion = {
    codigo: "canal.prueba",
    // Texto deliberadamente raro: si la interfaz lo reescribiera, este test cae.
    mensaje: "El canal dice exactamente esto y la bandeja no lo toca.",
    alternativa: { tipo: "plantilla", etiqueta: "Enviar una plantilla aprobada" },
  };

  it("muestra el texto del canal palabra por palabra", () => {
    const html = pintar(hiloDe("tuyo", RESTRICCION));
    expect(html).toContain("El canal dice exactamente esto y la bandeja no lo toca.");
    expect(html).toContain("Enviar una plantilla aprobada");
  });

  it("no reimplementa la ventana de 24 horas ni la explica por su cuenta", () => {
    const html = pintar(hiloDe("tuyo", RESTRICCION));
    // La bandeja no sabe qué es una ventana de servicio: si estas palabras
    // aparecen sin venir del canal, alguien duplicó la regla aquí.
    expect(html).not.toContain("24 horas");
    expect(html).not.toContain("ventana de servicio");
  });

  it("bloquea el envío aunque el control sea tuyo", () => {
    const html = pintar(hiloDe("tuyo", RESTRICCION));
    expect(areaBloqueada(html)).toBe(true);
  });
});
