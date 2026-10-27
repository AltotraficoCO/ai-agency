"use client";

/**
 * «Tú tienes la última palabra»: las dos piezas que lo demuestran.
 *
 * El chat enseña la regla de color del producto —verde es la IA, azul es una
 * persona del equipo— con el momento en que el agente se aparta. El permiso es
 * para tocar: se aprueba o se aplaza y cae el sello, que es lo que pasa de
 * verdad en la bandeja cuando Marketing quiere mover dinero.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { RotateCcw } from "lucide-react";

type Linea =
  | { de: "cliente" | "ia" | "humano"; texto: string }
  | { de: "sistema"; texto: string };

const CONVERSACION: readonly Linea[] = [
  { de: "cliente", texto: "Hola, ¿tienen cita para el sábado?" },
  { de: "ia", texto: "¡Hola, Carolina! El sábado hay espacio a las 10:00 y a las 3:00 p. m. ¿Cuál te sirve?" },
  { de: "cliente", texto: "A las 10. Y quiero hablar con alguien por una devolución." },
  { de: "sistema", texto: "Comunicaciones le pasó la conversación a Andrés" },
  { de: "humano", texto: "Hola, Carolina, soy Andrés. Tu cita del sábado quedó. Cuéntame qué pasó con el pedido." },
];

export function ChatWhatsApp({ avatar }: { avatar: string }) {
  const caja = useRef<HTMLDivElement>(null);
  const [visto, setVisto] = useState(0);
  const [escribiendo, setEscribiendo] = useState<"ia" | "humano" | null>(null);

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const relojes: number[] = [];
    const vigia = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        vigia.disconnect();
        // Sin movimiento, la conversación aparece entera de una vez.
        if (quieto) {
          setVisto(CONVERSACION.length);
          return;
        }
        let t = 300;
        CONVERSACION.forEach((linea, i) => {
          if (linea.de === "ia" || linea.de === "humano") {
            const quien = linea.de;
            relojes.push(window.setTimeout(() => setEscribiendo(quien), t));
            t += 1300;
          }
          relojes.push(
            window.setTimeout(() => {
              setEscribiendo(null);
              setVisto(i + 1);
            }, t),
          );
          t += linea.de === "sistema" ? 900 : 1100;
        });
      },
      { threshold: 0.45 },
    );
    vigia.observe(el);
    return () => {
      vigia.disconnect();
      relojes.forEach((r) => window.clearTimeout(r));
    };
  }, []);

  return (
    <div ref={caja} className="lp-telefono">
      <div className="lp-telefono-cabeza">
        <div className="lp-telefono-avatar">C</div>
        <div>
          <div className="lp-telefono-nombre">Carolina Ruiz</div>
          <div className="lp-telefono-estado">{escribiendo === "ia"
              ? "Comunicaciones está respondiendo…"
              : escribiendo === "humano"
                ? "Andrés está respondiendo…"
                : "cliente · WhatsApp"}</div>
        </div>
      </div>
      <div className="lp-telefono-mensajes" aria-live="polite">
        {CONVERSACION.slice(0, visto).map((l, i) =>
          l.de === "sistema" ? (
            <div key={i} className="lp-msj-sistema">
              {l.texto}
            </div>
          ) : (
            <div key={i} className={`lp-msj lp-msj-${l.de}`}>
              {l.de !== "cliente" && (
                <span className="lp-msj-quien">
                  {l.de === "ia" ? (
                    <>
                      <Image src={avatar} alt="" width={18} height={18} /> Comunicaciones · IA
                    </>
                  ) : (
                    "Andrés · tu equipo"
                  )}
                </span>
              )}
              {l.texto}
            </div>
          ),
        )}
        {escribiendo && (
          <div className={`lp-msj lp-msj-${escribiendo} lp-msj-puntos`} aria-label="Escribiendo">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
    </div>
  );
}

type Decision = "pendiente" | "aprobado" | "aplazado";

export function Permiso({ avatar }: { avatar: string }) {
  const tarjeta = useRef<HTMLDivElement>(null);
  const sello = useRef<HTMLDivElement>(null);
  const [decision, setDecision] = useState<Decision>("pendiente");

  // El sello cae cuando ya existe en el DOM: tras decidir, no al pulsar.
  useGSAP(
    () => {
      if (decision === "pendiente" || !sello.current || !tarjeta.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const aprobado = decision === "aprobado";
      gsap
        .timeline()
        .fromTo(
          sello.current,
          { scale: 2.6, opacity: 0, rotate: aprobado ? -28 : 18 },
          { scale: 1, opacity: 1, rotate: aprobado ? -12 : 8, duration: 0.22, ease: "power4.in" },
        )
        .fromTo(tarjeta.current, { y: 0 }, { y: 7, duration: 0.06, yoyo: true, repeat: 1, ease: "power1.out" })
        .fromTo(
          ".lp-permiso-miga",
          { scale: 0, opacity: 1, x: 0, y: 0 },
          {
            scale: 1,
            opacity: 0,
            x: () => gsap.utils.random(-120, 120),
            y: () => gsap.utils.random(-90, 60),
            rotate: () => gsap.utils.random(-180, 180),
            duration: 0.7,
            ease: "power3.out",
            stagger: 0.01,
          },
          "<",
        );
    },
    { scope: tarjeta, dependencies: [decision] },
  );

  return (
    <div ref={tarjeta} className="lp-permiso" data-decision={decision}>
      <div className="lp-permiso-cabeza">
        <Image src={avatar} alt="" width={44} height={44} />
        <div>
          <div className="lp-permiso-quien">Marketing te pide permiso</div>
          <div className="lp-permiso-hora">hoy · 10:37</div>
        </div>
      </div>
      <p className="lp-permiso-texto">
        Pausar la campaña <strong>«Promo octubre»</strong>: lleva nueve días gastando sin traer clientes. Ese
        presupuesto pasaría a <strong>«Búsqueda de marca»</strong>, que sí está vendiendo.
      </p>
      <dl className="lp-permiso-cifras">
        <div>
          <dt>Gastado sin resultado</dt>
          <dd>$ 412.000</dd>
        </div>
        <div>
          <dt>Clientes que trajo</dt>
          <dd>0</dd>
        </div>
      </dl>
      {decision === "pendiente" ? (
        <div className="lp-permiso-botones">
          <button type="button" className="lp-boton lp-boton-marca" onClick={() => setDecision("aprobado")}>
            Aprobar
          </button>
          <button type="button" className="lp-boton lp-boton-borde" onClick={() => setDecision("aplazado")}>
            Ahora no
          </button>
        </div>
      ) : (
        <div className="lp-permiso-botones">
          <span className="lp-permiso-resultado">
            {decision === "aprobado" ? "Hecho. Marketing ya movió el presupuesto." : "Queda en espera. Nadie toca nada."}
          </span>
          <button type="button" className="lp-boton-icono" onClick={() => setDecision("pendiente")} aria-label="Repetir">
            <RotateCcw size={16} />
          </button>
        </div>
      )}
      {decision !== "pendiente" && (
        <>
          <div ref={sello} className={`lp-sello lp-sello-${decision}`} aria-hidden>
            {decision === "aprobado" ? "APROBADO" : "EN ESPERA"}
          </div>
          <div className="lp-permiso-migas" aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} className="lp-permiso-miga" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
