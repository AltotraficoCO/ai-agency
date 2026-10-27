"use client";

/**
 * La landing de Strappy: «contrata a tu equipo».
 *
 * Toda la página cuenta una sola idea —no vendemos una herramienta, vendemos
 * un equipo— y cada sección la cuenta con un objeto de oficina: la
 * acreditación que cuelga de su cinta, el expediente de personal, el reloj de
 * la jornada, el sello de aprobado y el recibo de fin de mes.
 *
 * El movimiento lo llevan GSAP (ScrollTrigger, SplitText y DrawSVG) y Lenis,
 * que suaviza el desplazamiento; la física de las acreditaciones va en su
 * propio componente con Matter.js. Todo respeta `prefers-reduced-motion`.
 */
import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Strap } from "@strappy/ui";
import { Acreditaciones } from "./acreditaciones";
import { ChatWhatsApp, Permiso } from "./mando";
import { Chulo, Circulo, FiltroHervor, Flecha, Subrayado } from "./garabatos";
import { CINTA_ABAJO, CINTA_ARRIBA, DISENADOR, EQUIPO, UN_DIA, type Momento } from "./datos";

gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin, useGSAP);

export function Landing({ claseFuentes }: { claseFuentes: string }) {
  const raiz = useRef<HTMLDivElement>(null);
  const velocidad = useRef(0);

  useGSAP(
    () => {
      const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Las funciones del reloj de GSAP no las limpia `useGSAP`: se apuntan aquí.
      const latidos: gsap.TickerCallback[] = [];
      const alReloj = (f: gsap.TickerCallback) => {
        gsap.ticker.add(f);
        latidos.push(f);
      };

      // ── Desplazamiento suave, sincronizado con ScrollTrigger ──────────────
      let lenis: Lenis | null = null;
      if (!quieto) {
        lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95 });
        lenis.on("scroll", (l: Lenis) => {
          velocidad.current = l.velocity;
          ScrollTrigger.update();
        });
        alReloj((t) => lenis?.raf(t * 1000));
        gsap.ticker.lagSmoothing(0);
        // La velocidad se apaga sola cuando la rueda para.
        alReloj(() => {
          velocidad.current *= 0.9;
        });
      }

      // Los enlaces internos pasan por Lenis, o el salto rompe la suavidad.
      const anclas = raiz.current?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]') ?? [];
      const alPulsarAncla = (e: Event) => {
        const destino = (e.currentTarget as HTMLAnchorElement).getAttribute("href");
        if (!destino || destino === "#") return;
        e.preventDefault();
        if (lenis) lenis.scrollTo(destino, { offset: -70 });
        else document.querySelector(destino)?.scrollIntoView();
      };
      anclas.forEach((a) => a.addEventListener("click", alPulsarAncla));

      // ── La barra flota siempre: «Contratar» tiene que estar a mano en toda
      // la página. Al bajar solo gana sombra, para separarse del contenido.
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (st) => {
          raiz.current?.querySelector(".lp-nav")?.setAttribute("data-fondo", st.scroll() < 80 ? "no" : "si");
        },
      });

      if (quieto) return () => anclas.forEach((a) => a.removeEventListener("click", alPulsarAncla));

      // ── Portada: el titular cae palabra a palabra, como piezas de plastilina
      const titular = SplitText.create(".lp-portada h1 .lp-linea", { type: "words", wordsClass: "lp-palabra" });
      gsap
        .timeline({ delay: 0.15 })
        .from(titular.words, {
          yPercent: 120,
          rotate: () => gsap.utils.random(-14, 14),
          opacity: 0,
          duration: 0.9,
          ease: "back.out(2.2)",
          stagger: 0.07,
        })
        .from(".lp-portada [data-trazo]", { drawSVG: 0, duration: 0.7, ease: "power2.inOut", stagger: 0.12 }, "-=0.3")
        .from(".lp-portada .lp-entrada", { y: 24, opacity: 0, duration: 0.6, ease: "power3.out", stagger: 0.08 }, "-=0.6");

      // ── Garabatos: se dibujan al entrar en pantalla ──────────────────────
      gsap.utils.toArray<SVGSVGElement>("section:not(.lp-portada) .lp-garabato").forEach((g) => {
        gsap.from(g.querySelectorAll("[data-trazo]"), {
          drawSVG: 0,
          duration: 0.8,
          ease: "power2.inOut",
          stagger: 0.15,
          scrollTrigger: { trigger: g, start: "top 85%" },
        });
      });

      // ── Títulos de sección: líneas que suben desde su máscara ─────────────
      gsap.utils.toArray<HTMLElement>(".lp-titulo").forEach((t) => {
        const partes = SplitText.create(t, { type: "lines", mask: "lines", linesClass: "lp-titulo-linea" });
        gsap.from(partes.lines, {
          yPercent: 105,
          duration: 0.9,
          ease: "expo.out",
          stagger: 0.08,
          scrollTrigger: { trigger: t, start: "top 85%" },
        });
      });

      // ── Cintas: corren solas y aceleran con el desplazamiento ────────────
      const cintas = gsap.utils.toArray<HTMLElement>(".lp-cinta-pista").map((pista, i) =>
        gsap.to(pista, { xPercent: i % 2 ? 0 : -50, ...(i % 2 ? { startAt: { xPercent: -50 } } : {}), duration: 38, ease: "none", repeat: -1 }),
      );
      alReloj(() => {
        const empuje = 1 + Math.min(Math.abs(velocidad.current) * 0.12, 5);
        cintas.forEach((c) => c.timeScale(gsap.utils.interpolate(c.timeScale(), empuje, 0.1)));
      });

      const mm = gsap.matchMedia();

      // ── Expedientes: se apilan uno sobre otro (solo con pantalla grande) ──
      mm.add("(min-width: 960px)", () => {
        const expedientes = gsap.utils.toArray<HTMLElement>(".lp-expediente");
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: ".lp-expedientes",
            start: "top top+=96",
            end: () => `+=${window.innerHeight * (expedientes.length - 1) * 0.9}`,
            scrub: 0.6,
            pin: true,
            anticipatePin: 1,
          },
        });
        // Entran desde abajo de la pantalla como una carpeta que se archiva
        // encima de la otra. Las de atrás no se apagan: siguen a la vista con
        // su pestaña, que va corrida, como en un archivador de verdad.
        expedientes.forEach((ex, i) => {
          if (i === 0) return;
          tl.fromTo(
            ex,
            { y: () => window.innerHeight, rotate: i % 2 ? 2.5 : -2.5 },
            { y: 0, rotate: 0, ease: "power3.out" },
            i - 1,
          );
        });
      });

      // ── Un día: el reloj avanza y la jornada corre en horizontal ──────────
      mm.add("(min-width: 960px)", () => {
        const pista = document.querySelector<HTMLElement>(".lp-dia-pista");
        const ventana = document.querySelector<HTMLElement>(".lp-dia-ventana");
        if (!pista || !ventana) return;
        // Se mide contra la ventana visible, no contra la pista: la pista mide
        // lo que su contenido, así que contra sí misma el recorrido salía casi
        // cero y la jornada saltaba de las 07:52 a las 18:30 sin verse.
        // El margen final deja la última tarjeta entera, fuera del fundido.
        const recorrido = () => Math.max(0, pista.scrollWidth - ventana.clientWidth + 180);
        const primera = UN_DIA[0].minutos;
        const ultima = UN_DIA[UN_DIA.length - 1].minutos;
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: ".lp-dia",
            start: "top top",
            end: () => `+=${recorrido() * 1.1}`,
            scrub: 0.8,
            pin: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: (st) => {
              const minutos = primera + (ultima - primera) * st.progress;
              const h = Math.floor(minutos / 60);
              const m = Math.floor(minutos % 60);
              const el = document.querySelector(".lp-reloj-digital");
              if (el) el.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
            },
          },
        });
        tl.to(pista, { x: () => -recorrido(), ease: "none" }, 0)
          .fromTo(
            ".lp-reloj-horas",
            { rotate: (primera / 60) * 30, svgOrigin: "100 100" },
            { rotate: (ultima / 60) * 30, svgOrigin: "100 100", ease: "none" },
            0,
          )
          .fromTo(
            ".lp-reloj-minutos",
            { rotate: primera * 6, svgOrigin: "100 100" },
            { rotate: ultima * 6, svgOrigin: "100 100", ease: "none" },
            0,
          );
      });

      // En el móvil la jornada va en vertical y cada momento aparece solo.
      mm.add("(max-width: 959px)", () => {
        gsap.utils.toArray<HTMLElement>(".lp-momento").forEach((m) => {
          gsap.from(m, { y: 40, opacity: 0, duration: 0.6, ease: "power3.out", scrollTrigger: { trigger: m, start: "top 88%" } });
        });
      });

      // ── Colaboración: la cinta que une a los dos agentes se tiende ───────
      const enlace = gsap.timeline({
        scrollTrigger: { trigger: ".lp-equipo-pasa", start: "top 70%", end: "bottom 60%", scrub: 0.6 },
      });
      enlace
        .from(".lp-pasa-cinta path", { drawSVG: 0, ease: "none", duration: 3 })
        .from(".lp-pasa-msj", { y: 20, opacity: 0, stagger: 1, duration: 0.6, ease: "power2.out" }, 0.4);

      // ── Recibo: sale de la impresora con el desplazamiento ───────────────
      gsap.fromTo(
        ".lp-recibo-papel",
        { clipPath: "inset(0 0 100% 0)", y: -40 },
        {
          clipPath: "inset(0 0 0% 0)",
          y: 0,
          ease: "steps(14)",
          scrollTrigger: { trigger: ".lp-recibo", start: "top 70%", end: "center 55%", scrub: 0.4 },
        },
      );

      // ── Cierre: los personajes se asoman por el borde ────────────────────
      gsap.from(".lp-asomados img", {
        yPercent: 100,
        rotate: () => gsap.utils.random(-20, 20),
        duration: 0.9,
        ease: "back.out(1.6)",
        stagger: 0.08,
        scrollTrigger: { trigger: ".lp-cierre", start: "top 60%" },
      });

      // Imágenes que flotan con un poco de paralaje.
      gsap.utils.toArray<HTMLElement>("[data-paralaje]").forEach((el) => {
        gsap.to(el, {
          yPercent: Number(el.dataset.paralaje ?? -10),
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        });
      });

      return () => {
        anclas.forEach((a) => a.removeEventListener("click", alPulsarAncla));
        latidos.forEach((f) => gsap.ticker.remove(f));
        lenis?.destroy();
      };
    },
    { scope: raiz },
  );

  const saltar = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.to(".lp-asomados img", {
      y: -34,
      duration: 0.22,
      ease: "power2.out",
      yoyo: true,
      repeat: 1,
      stagger: { each: 0.05, from: "center" },
      overwrite: "auto",
    });
  };

  const [comunicaciones, marketing, webmaster] = EQUIPO;

  return (
    <div ref={raiz} className={`landing ${claseFuentes}`}>
      <FiltroHervor />
      <div className="lp-grano" aria-hidden />

      {/* ── Barra ─────────────────────────────────────────────────────── */}
      <header className="lp-nav" data-fondo="no">
        <Link href="/" className="lp-logo" aria-label="Strappy, inicio">
          <Strap pose="saludando" size={34} animate={false} />
          <span>strappy</span>
        </Link>
        <nav className="lp-nav-enlaces" aria-label="Secciones">
          <a href="#equipo">El equipo</a>
          <a href="#un-dia">Un día</a>
          <a href="#mando">Quién manda</a>
          <a href="#recibo">Cómo se paga</a>
        </nav>
        <div className="lp-nav-acciones">
          <Link href="/entrar" className="lp-nav-entrar">
            Entrar
          </Link>
          <Link href="/registro" className="lp-boton lp-boton-marca lp-boton-chico">
            Contratar
          </Link>
        </div>
      </header>

      <main>
        {/* ── Portada ──────────────────────────────────────────────────── */}
        <section className="lp-portada">
          <div className="lp-portada-texto">
            <p className="lp-mano lp-entrada">Strappy · tu agencia de IA</p>
            <h1>
              <span className="lp-linea">Tu equipo nuevo</span>
              <span className="lp-linea">
                empieza{" "}
                <span className="lp-acento">
                  el lunes.
                  <Subrayado className="lp-acento-subrayado" />
                </span>
              </span>
            </h1>
            <p className="lp-portada-bajada lp-entrada">
              Cuatro agentes de IA que se reparten el trabajo de tu negocio: contestan tu WhatsApp, vigilan tus
              anuncios, cuidan tu web y llevan tus cuentas. Ellos hacen; tú das el visto bueno.
            </p>
            <div className="lp-portada-acciones lp-entrada">
              <Link href="/registro" className="lp-boton lp-boton-marca lp-boton-grande">
                Contratar a mi equipo <ArrowRight size={18} />
              </Link>
              <a href="#un-dia" className="lp-enlace-mano">
                o mira un día de trabajo
              </a>
            </div>
          </div>
          <div className="lp-portada-colgadero">
            <Acreditaciones equipo={EQUIPO} velocidad={velocidad} />
            <div className="lp-pista-tirar lp-entrada" aria-hidden>
              <Flecha className="lp-pista-flecha" />
              <span className="lp-mano">¡tíralos de la cinta!</span>
            </div>
          </div>
        </section>

        {/* ── Cintas ───────────────────────────────────────────────────── */}
        <div className="lp-cintas" aria-hidden>
          <div className="lp-cinta lp-cinta-verde">
            <div className="lp-cinta-pista">
              {[...CINTA_ARRIBA, ...CINTA_ARRIBA].map((t, i) => (
                <span key={i}>
                  {t}
                  <b>✕</b>
                </span>
              ))}
            </div>
          </div>
          <div className="lp-cinta lp-cinta-oscura">
            <div className="lp-cinta-pista">
              {[...CINTA_ABAJO, ...CINTA_ABAJO, ...CINTA_ABAJO, ...CINTA_ABAJO].map((t, i) => (
                <span key={i}>
                  {t}
                  <b>●</b>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── El equipo: expedientes ──────────────────────────────────── */}
        <section id="equipo" className="lp-seccion">
          <div className="lp-cabecera">
            <p className="lp-mano">el equipo</p>
            <h2 className="lp-titulo">
              No es otra herramienta.
              <br />
              Es gente que hace cosas.
            </h2>
            <p className="lp-cabecera-bajada">
              Bueno, gente de plastilina. Cada uno tiene su oficio, sus permisos y una regla que no se salta.
            </p>
          </div>

          <div className="lp-expedientes">
            {EQUIPO.map((m, i) => (
              <article
                key={m.slug}
                className="lp-expediente"
                style={{ ["--color" as string]: m.color, ["--i" as string]: i, zIndex: i + 1 }}>
                <div className="lp-expediente-pestana">
                  Exp. {m.numero} · {m.departamento}
                </div>
                <div className="lp-expediente-cuerpo">
                  <div className="lp-expediente-foto">
                    <div className="lp-expediente-halo" />
                    <Image src={m.imagen} alt={`Personaje de ${m.departamento}`} width={340} height={340} />
                    <span className="lp-expediente-clip" aria-hidden />
                  </div>
                  <div className="lp-expediente-datos">
                    <div className="lp-expediente-fila">
                      <span>Departamento</span>
                      <strong>{m.departamento}</strong>
                    </div>
                    <h3>{m.puesto}</h3>
                    <p className="lp-expediente-etiqueta">Se encarga de</p>
                    <ul>
                      {m.seEncarga.map((s) => (
                        <li key={s}>
                          <Chulo className="lp-chulo" color={m.color} />
                          {s}
                        </li>
                      ))}
                    </ul>
                    <div className="lp-expediente-regla">
                      <span>Regla de la casa</span>
                      {m.regla}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── Un día en la oficina ─────────────────────────────────────── */}
        <section id="un-dia" className="lp-dia">
          <div className="lp-dia-marco">
            <div className="lp-dia-lado">
              <p className="lp-mano">un día cualquiera</p>
              <h2 className="lp-titulo">Así se ve un martes.</h2>
              <Reloj />
              <p className="lp-dia-nota">Sigue bajando: el reloj avanza contigo.</p>
            </div>
            <div className="lp-dia-ventana">
              <ol className="lp-dia-pista">
                {UN_DIA.map((m) => (
                  <MomentoDelDia key={m.hora} momento={m} />
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── Quién manda ──────────────────────────────────────────────── */}
        <section id="mando" className="lp-seccion lp-mando">
          <div className="lp-cabecera">
            <p className="lp-mano">quién manda</p>
            <h2 className="lp-titulo">
              Tú tienes la{" "}
              <span className="lp-acento-circulo">
                última palabra.
                <Circulo className="lp-circulo" />
              </span>
            </h2>
            <p className="lp-cabecera-bajada">
              Verde es la IA; azul, una persona de tu equipo. Cuando hace falta alguien de verdad, el agente se aparta.
              Y lo que mueve tu dinero o toca tu web espera tu visto bueno.
            </p>
          </div>
          <div className="lp-mando-rejilla">
            <div className="lp-mando-col">
              <ChatWhatsApp avatar={comunicaciones.imagen} />
              <p className="lp-pie lp-mano">la IA contesta, Andrés entra cuando hace falta</p>
            </div>
            <div className="lp-mando-col lp-mando-col-permiso">
              <Permiso avatar={marketing.imagen} />
              <p className="lp-pie lp-mano">venga, pulsa uno de los dos</p>
            </div>
          </div>
        </section>

        {/* ── Se pasan el trabajo ──────────────────────────────────────── */}
        <section className="lp-seccion lp-equipo-pasa">
          <div className="lp-cabecera lp-cabecera-centro">
            <p className="lp-mano">trabajo en equipo</p>
            <h2 className="lp-titulo">Si no es su oficio, se lo pide a quien sabe.</h2>
          </div>
          <div className="lp-pasa">
            <figure className="lp-pasa-agente" style={{ ["--color" as string]: webmaster.color }}>
              <Image src={webmaster.imagen} alt="" width={220} height={220} data-paralaje="-8" />
              <figcaption>Webmaster</figcaption>
            </figure>
            <svg className="lp-pasa-cinta" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden>
              <path
                d="M10 110 C 110 20, 190 150, 300 80 S 480 10, 590 70"
                stroke="#1B7A0C"
                strokeWidth="16"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M10 110 C 110 20, 190 150, 300 80 S 480 10, 590 70"
                stroke="#39FF14"
                strokeWidth="11"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <figure className="lp-pasa-agente" style={{ ["--color" as string]: DISENADOR.color }}>
              <Image src={DISENADOR.imagen} alt="" width={220} height={220} data-paralaje="-14" />
              <figcaption>{DISENADOR.departamento}</figcaption>
            </figure>
            <div className="lp-pasa-mensajes">
              <div className="lp-pasa-msj lp-pasa-izq">
                <b>Webmaster</b> Necesito el banner de la promo, 1200 × 400, con los colores del sitio.
              </div>
              <div className="lp-pasa-msj lp-pasa-der">
                <b>Diseño</b> Listo. Lo dejé subido en tu biblioteca de medios.
              </div>
              <div className="lp-pasa-msj lp-pasa-izq">
                <b>Webmaster</b> Ya está en la portada. Solo falta tu clic para publicar.
              </div>
            </div>
          </div>
        </section>

        {/* ── Recibo ───────────────────────────────────────────────────── */}
        <section id="recibo" className="lp-seccion lp-recibo">
          <div className="lp-recibo-texto">
            <p className="lp-mano">cómo se paga</p>
            <h2 className="lp-titulo">Sin nómina. Pagas el trabajo hecho.</h2>
            <p className="lp-cabecera-bajada">
              Recargas créditos y tu equipo los gasta trabajando. Contratas a los agentes que necesites y ves en qué se
              fue cada crédito, agente por agente.
            </p>
            <p className="lp-cabecera-bajada">
              Los mensajes de WhatsApp te los cobra Meta directamente, sin que nosotros le pongamos un peso encima.
            </p>
          </div>
          <div className="lp-impresora">
            <div className="lp-impresora-boca" aria-hidden />
            <div className="lp-recibo-papel">
              <div className="lp-recibo-cabeza">
                <strong>STRAPPY</strong>
                <span>Tu agencia · resumen del mes</span>
              </div>
              <ul className="lp-recibo-lineas">
                <li>
                  <span>Sueldos</span>
                  <i />
                  <span>no hay</span>
                </li>
                <li>
                  <span>Prestaciones</span>
                  <i />
                  <span>no hay</span>
                </li>
                <li>
                  <span>Vacaciones</span>
                  <i />
                  <span>no se toman</span>
                </li>
                <li>
                  <span>Horas extra</span>
                  <i />
                  <span>no existen</span>
                </li>
                <li>
                  <span>Mensajes de WhatsApp</span>
                  <i />
                  <span>los cobra Meta</span>
                </li>
                <li className="lp-recibo-total">
                  <span>Trabajo hecho</span>
                  <i />
                  <span>en créditos</span>
                </li>
              </ul>
              <p className="lp-recibo-gracias">Gracias por no tener que contratar a nadie más.</p>
              <div className="lp-recibo-barras" aria-hidden />
            </div>
          </div>
        </section>

        {/* ── Cierre ───────────────────────────────────────────────────── */}
        <section className="lp-cierre">
          <p className="lp-mano">entonces…</p>
          <h2 className="lp-cierre-titulo">¿Empiezan el lunes?</h2>
          <Link href="/registro" className="lp-boton lp-boton-marca lp-boton-enorme" onMouseEnter={saltar} onFocus={saltar}>
            Contratar a mi equipo <ArrowUpRight size={22} />
          </Link>
          <p className="lp-cierre-pie">
            ¿Ya tienes cuenta? <Link href="/entrar">Entra aquí</Link>
          </p>
          <div className="lp-asomados" aria-hidden>
            {[EQUIPO[2], EQUIPO[0], EQUIPO[1], EQUIPO[3]].map((m) => (
              <Image key={m.slug} src={m.imagen} alt="" width={220} height={220} />
            ))}
          </div>
        </section>
      </main>

      <footer className="lp-pie-pagina">
        <div className="lp-logo">
          <Strap pose="dormido" size={30} animate={false} />
          <span>strappy</span>
        </div>
        <nav aria-label="Legal">
          <Link href="/policy">Privacidad</Link>
          <Link href="/terms">Términos</Link>
          <Link href="/entrar">Entrar</Link>
        </nav>
        <span>© {new Date().getFullYear()} Strappy</span>
      </footer>
    </div>
  );
}

function Reloj() {
  const marcas = Array.from({ length: 12 }, (_, i) => i);
  return (
    <div className="lp-reloj" role="img" aria-label="Reloj de la jornada">
      <svg viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="92" className="lp-reloj-esfera" />
        {marcas.map((i) => (
          <line
            key={i}
            x1="100"
            y1={i % 3 === 0 ? 18 : 22}
            x2="100"
            y2="30"
            transform={`rotate(${i * 30} 100 100)`}
            className="lp-reloj-marca"
          />
        ))}
        <g className="lp-reloj-horas" transform="rotate(236 100 100)">
          <line x1="100" y1="100" x2="100" y2="56" />
        </g>
        <g className="lp-reloj-minutos" transform="rotate(312 100 100)">
          <line x1="100" y1="100" x2="100" y2="34" />
        </g>
        <circle cx="100" cy="100" r="7" className="lp-reloj-centro" />
      </svg>
      <div className="lp-reloj-digital">07:52</div>
    </div>
  );
}

function MomentoDelDia({ momento: m }: { momento: Momento }) {
  return (
    <li className={`lp-momento lp-momento-${m.forma}`} style={{ ["--color" as string]: m.color }}>
      <div className="lp-momento-hora">{m.hora}</div>
      <div className="lp-momento-tarjeta">
        <div className="lp-momento-quien">
          {m.imagen ? <Image src={m.imagen} alt="" width={40} height={40} /> : <span className="lp-momento-tu">Tú</span>}
          <span>{m.quien}</span>
        </div>
        <p>{m.texto}</p>
        {m.forma === "permiso" && (
          <div className="lp-momento-botones" aria-hidden>
            <span className="lp-mini-marca">Aprobar</span>
            <span className="lp-mini-borde">Ahora no</span>
          </div>
        )}
      </div>
    </li>
  );
}
