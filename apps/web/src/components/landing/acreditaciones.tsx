"use client";

/**
 * Las acreditaciones del equipo, colgando de su cinta.
 *
 * Strappy viene de *strap*: la cinta de la que cuelga una acreditación. Aquí
 * cada agente es una acreditación de verdad, con física: cuelga de una cuerda
 * de eslabones (Matter.js), se balancea cuando la
 * página se desplaza y se puede agarrar y lanzar.
 *
 * La física solo mueve cuerpos; quien se ve son elementos del DOM a los que se
 * les copia posición y giro en cada fotograma, y la cinta se pinta en un
 * canvas por detrás. El arrastre no usa `MouseConstraint` de Matter: ese
 * escucha la rueda y el toque en todo el contenedor y deja la página sin
 * desplazamiento en el móvil. Aquí solo se agarra la tarjeta.
 */
import { useEffect, useRef } from "react";
import Image from "next/image";
import Matter from "matter-js";
import type { Miembro } from "./datos";

type Props = {
  readonly equipo: readonly Miembro[];
  /** Velocidad de desplazamiento de la página, para que el viento mueva las tarjetas. */
  readonly velocidad: { current: number };
};

const ESLABONES = 9;

export function Acreditaciones({ equipo, velocidad }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const tarjetas = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const contenedor = caja.current;
    const canvas = lienzo.current;
    if (!contenedor || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { Engine, Bodies, Body, Composite, Constraint } = Matter;

    let ancho = 0;
    let alto = 0;
    let motor = Engine.create();
    let cuerdas: { ancla: Matter.Vector; eslabones: Matter.Body[]; tarjeta: Matter.Body; alto: number }[] = [];
    let agarre: { restriccion: Matter.Constraint; id: number } | null = null;

    function montar() {
      ancho = contenedor!.clientWidth;
      alto = contenedor!.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = ancho * dpr;
      canvas!.height = alto * dpr;
      canvas!.style.width = `${ancho}px`;
      canvas!.style.height = `${alto}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      motor = Engine.create({
        gravity: { x: 0, y: 1, scale: 0.0012 },
        // Una cuerda de eslabones ligeros con una tarjeta colgando se estira
        // como un chicle con las iteraciones por defecto.
        constraintIterations: 8,
        positionIterations: 10,
      });
      cuerdas = [];

      // Se mide la ventana y no la caja: en escritorio la caja es media portada.
      const vw = window.innerWidth;
      const estrecho = vw < 900;
      const tw = vw < 560 ? 112 : estrecho ? 132 : 196;
      const th = vw < 560 ? 154 : estrecho ? 186 : 272;
      // Cada tarjeta cuelga a una altura distinta para que no formen una fila
      // de uniformes: la de en medio, más baja, es la que se ve primero.
      const largos = estrecho ? [0.3, 0.46, 0.24, 0.4] : [0.12, 0.44, 0.06, 0.34];
      const columnas = equipo.length;

      // Pared invisible a la izquierda: por mucho que se lancen, las tarjetas
      // no invaden el titular.
      Composite.add(
        motor.world,
        Bodies.rectangle(-30, alto / 2, 60, alto * 3, { isStatic: true, collisionFilter: { category: 0x0004, mask: 0x0001 } }),
      );

      equipo.forEach((_, i) => {
        // Repartidas de borde a borde sin que la primera asome sobre el titular.
        const margen = tw / 2 + 8;
        const ancla = { x: margen + ((ancho - margen * 2) / (columnas - 1)) * i, y: -12 };
        const largo = alto * largos[i % largos.length] + 40;
        const tramo = largo / ESLABONES;
        // Cuelgan rectas y reciben un empujón al montarse: entran meciéndose,
        // como si alguien las acabara de colgar. Soltarlas torcidas las hacía
        // enredarse unas con otras antes de que nadie las tocara.
        const giro = 0;
        const dx = Math.sin(giro);
        const dy = Math.cos(giro);

        const eslabones: Matter.Body[] = [];
        for (let k = 1; k <= ESLABONES; k++) {
          eslabones.push(
            Bodies.circle(ancla.x + dx * tramo * k, ancla.y + dy * tramo * k, 3, {
              frictionAir: 0.03,
              density: 0.02,
              collisionFilter: { category: 0x0002, mask: 0 },
            }),
          );
        }
        const ultimo = eslabones[eslabones.length - 1];
        const tarjeta = Bodies.rectangle(ultimo.position.x + dx * (th / 2), ultimo.position.y + dy * (th / 2), tw, th, {
          chamfer: { radius: 18 },
          frictionAir: 0.022,
          density: 0.0005,
          restitution: 0.2,
          angle: -giro,
          // Solo chocan con la pared: colgadas tan juntas, si chocaran entre
          // ellas se empujarían sin parar y acabarían de lado.
          collisionFilter: { category: 0x0001, mask: 0x0004 },
        });
        if (!quieto) Body.setVelocity(tarjeta, { x: (i % 2 ? -1 : 1) * (4 + (i % 3)), y: 0 });

        const uniones: Matter.Constraint[] = [
          Constraint.create({ pointA: ancla, bodyB: eslabones[0], length: tramo, stiffness: 0.95, damping: 0.05 }),
        ];
        for (let k = 1; k < eslabones.length; k++) {
          uniones.push(
            Constraint.create({ bodyA: eslabones[k - 1], bodyB: eslabones[k], length: tramo, stiffness: 0.95, damping: 0.05 }),
          );
        }
        uniones.push(
          Constraint.create({
            bodyA: ultimo,
            bodyB: tarjeta,
            pointB: { x: dx * (-th / 2 + 6), y: dy * (-th / 2 + 6) },
            length: 2,
            stiffness: 0.9,
            damping: 0.08,
          }),
        );
        Composite.add(motor.world, [...eslabones, tarjeta, ...uniones]);
        cuerdas.push({ ancla, eslabones, tarjeta, alto: th });

        const el = tarjetas.current[i];
        if (el) {
          el.style.width = `${tw}px`;
          el.style.height = `${th}px`;
          // La que cuelga más abajo va delante, como en un tablero de llaves.
          el.style.zIndex = String(Math.round(largo));
        }
      });
    }

    function puntoDeCinta(c: (typeof cuerdas)[number]) {
      const { tarjeta } = c;
      const off = -c.alto / 2 + 6;
      return {
        x: tarjeta.position.x - Math.sin(tarjeta.angle) * off,
        y: tarjeta.position.y + Math.cos(tarjeta.angle) * off,
      };
    }

    function pintar() {
      ctx!.clearRect(0, 0, ancho, alto);
      for (const c of cuerdas) {
        const puntos = [c.ancla, ...c.eslabones.map((e) => e.position), puntoDeCinta(c)];
        const trazo = () => {
          ctx!.beginPath();
          ctx!.moveTo(puntos[0].x, puntos[0].y);
          // Curva por los puntos medios: la cinta es tela, no una cadena.
          for (let k = 1; k < puntos.length - 1; k++) {
            const mx = (puntos[k].x + puntos[k + 1].x) / 2;
            const my = (puntos[k].y + puntos[k + 1].y) / 2;
            ctx!.quadraticCurveTo(puntos[k].x, puntos[k].y, mx, my);
          }
          const fin = puntos[puntos.length - 1];
          ctx!.lineTo(fin.x, fin.y);
        };
        ctx!.lineCap = "round";
        ctx!.lineJoin = "round";
        // Canto oscuro, cuerpo verde y una costura punteada: plastilina con puntadas.
        trazo();
        ctx!.strokeStyle = "#1B7A0C";
        ctx!.lineWidth = 15;
        ctx!.stroke();
        trazo();
        ctx!.strokeStyle = "#39FF14";
        ctx!.lineWidth = 11;
        ctx!.stroke();
        trazo();
        ctx!.strokeStyle = "rgba(0,0,0,0.55)";
        ctx!.setLineDash([5, 6]);
        ctx!.lineWidth = 1.4;
        ctx!.stroke();
        ctx!.setLineDash([]);
      }
    }

    function colocar() {
      cuerdas.forEach((c, i) => {
        const el = tarjetas.current[i];
        if (!el) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        el.style.transform = `translate3d(${c.tarjeta.position.x - w / 2}px, ${c.tarjeta.position.y - h / 2}px, 0) rotate(${c.tarjeta.angle}rad)`;
      });
    }

    montar();
    if (quieto) {
      // Sin movimiento: se dejan asentar fuera de pantalla y se pintan una vez.
      for (let k = 0; k < 240; k++) Engine.update(motor, 1000 / 60);
      colocar();
      pintar();
    }

    let visible = true;
    let marco = 0;
    let anterior = performance.now();
    let acumulado = 0;
    const PASO = 1000 / 60;

    function bucle(ahora: number) {
      marco = requestAnimationFrame(bucle);
      if (!visible) {
        anterior = ahora;
        return;
      }
      acumulado += Math.min(ahora - anterior, 100);
      anterior = ahora;

      // El viento de la página: al desplazarse, las tarjetas se mecen en
      // sentidos contrarios, como colgadas en un pasillo con corriente.
      const v = Math.max(-40, Math.min(40, velocidad.current));
      while (acumulado >= PASO) {
        if (Math.abs(v) > 0.2) {
          cuerdas.forEach((c, i) => {
            Body.applyForce(c.tarjeta, c.tarjeta.position, {
              x: v * 0.0000045 * c.tarjeta.mass * (i % 2 ? 1 : -1),
              y: 0,
            });
          });
        }
        Engine.update(motor, PASO);
        acumulado -= PASO;
      }
      colocar();
      pintar();
    }
    if (!quieto) marco = requestAnimationFrame(bucle);

    const vigia = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    vigia.observe(contenedor);

    // ── Agarrar y lanzar ──────────────────────────────────────────────────
    function local(ev: PointerEvent) {
      const r = contenedor!.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }
    const alBajar = (i: number) => (ev: PointerEvent) => {
      if (quieto) return;
      const c = cuerdas[i];
      if (!c) return;
      ev.preventDefault();
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      const p = local(ev);
      const restriccion = Constraint.create({
        pointA: p,
        bodyB: c.tarjeta,
        pointB: { x: p.x - c.tarjeta.position.x, y: p.y - c.tarjeta.position.y },
        length: 0,
        stiffness: 0.08,
        damping: 0.1,
      });
      Composite.add(motor.world, restriccion);
      agarre = { restriccion, id: ev.pointerId };
      (ev.currentTarget as HTMLElement).dataset.agarrada = "si";
    };
    const alMover = (ev: PointerEvent) => {
      if (!agarre || ev.pointerId !== agarre.id) return;
      const p = local(ev);
      agarre.restriccion.pointA = p;
    };
    const alSoltar = (ev: PointerEvent) => {
      if (!agarre || ev.pointerId !== agarre.id) return;
      Composite.remove(motor.world, agarre.restriccion);
      agarre = null;
      for (const el of tarjetas.current) if (el) delete el.dataset.agarrada;
    };

    const quitar: (() => void)[] = [];
    tarjetas.current.forEach((el, i) => {
      if (!el) return;
      const h = alBajar(i);
      el.addEventListener("pointerdown", h);
      quitar.push(() => el.removeEventListener("pointerdown", h));
    });
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    window.addEventListener("pointercancel", alSoltar);

    // Un cambio de ancho rehace el mundo; uno de alto (la barra del móvil que
    // aparece y desaparece) no, o las tarjetas saltarían en cada desplazamiento.
    let anchoPrevio = contenedor.clientWidth;
    const observador = new ResizeObserver(() => {
      if (contenedor.clientWidth === anchoPrevio) return;
      anchoPrevio = contenedor.clientWidth;
      Engine.clear(motor);
      montar();
      if (quieto) {
        for (let k = 0; k < 240; k++) Engine.update(motor, 1000 / 60);
        colocar();
        pintar();
      }
    });
    observador.observe(contenedor);

    return () => {
      cancelAnimationFrame(marco);
      vigia.disconnect();
      observador.disconnect();
      quitar.forEach((f) => f());
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      window.removeEventListener("pointercancel", alSoltar);
      Engine.clear(motor);
    };
  }, [equipo, velocidad]);

  return (
    <div ref={caja} className="lp-colgadero" aria-label="El equipo: cuatro acreditaciones colgando de su cinta">
      <canvas ref={lienzo} className="lp-colgadero-cinta" aria-hidden />
      {equipo.map((m, i) => (
        <div
          key={m.slug}
          ref={(el) => {
            tarjetas.current[i] = el;
          }}
          className="lp-acreditacion"
          style={{ ["--color" as string]: m.color }}
        >
          <div className="lp-acreditacion-ranura" aria-hidden />
          <div className="lp-acreditacion-banda">
            <span>STRAPPY</span>
            <span>Nº {m.numero}</span>
          </div>
          <div className="lp-acreditacion-foto">
            <Image src={m.imagen} alt="" width={160} height={160} draggable={false} priority={i < 2} />
          </div>
          <div className="lp-acreditacion-nombre">{m.departamento}</div>
          <div className="lp-acreditacion-puesto">{m.puesto}</div>
          <div className="lp-acreditacion-barras" aria-hidden />
        </div>
      ))}
    </div>
  );
}
