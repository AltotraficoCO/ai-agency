/**
 * El texto de la landing, aparte de cómo se pinta.
 *
 * Las caras son las mismas que usa el catálogo (`catalog_agents.avatar_url`,
 * migración 0037): quien entra por aquí y luego contrata reconoce al mismo
 * personaje dentro de la app. Los cuatro son los del lanzamiento.
 */

export type Miembro = {
  readonly slug: string;
  readonly departamento: string;
  readonly puesto: string;
  readonly imagen: string;
  /** El color de su plastilina: halo, banda de la acreditación y pestaña del expediente. */
  readonly color: string;
  readonly numero: string;
  readonly seEncarga: readonly string[];
  readonly regla: string;
};

export const EQUIPO: readonly Miembro[] = [
  {
    slug: "comunicaciones",
    departamento: "Comunicaciones",
    puesto: "Atiende tu WhatsApp",
    imagen: "/avatares/whatsapp/02.webp",
    color: "#B48CFF",
    numero: "0001",
    seEncarga: [
      "Contesta a tus clientes a cualquier hora, con lo que sabe de tu negocio",
      "Agenda citas, toma pedidos y resuelve las dudas de siempre",
      "Te pasa la conversación cuando hace falta una persona",
    ],
    regla: "Cuando el cliente necesita a alguien de carne y hueso, se aparta.",
  },
  {
    slug: "marketing",
    departamento: "Marketing",
    puesto: "Vigila tus anuncios",
    imagen: "/agentes/marketing-plastilina.webp",
    color: "#FF6B6B",
    numero: "0002",
    seEncarga: [
      "Revisa tus campañas de Google Ads, Facebook e Instagram",
      "Te dice cuánto te cuesta cada cliente y qué campaña gasta sin traer nada",
      "Propone mover el presupuesto hacia lo que sí funciona",
    ],
    regla: "Nunca mueve tu dinero sin que lo apruebes.",
  },
  {
    slug: "webmaster",
    departamento: "Desarrollo",
    puesto: "Cuida tu web",
    imagen: "/agentes/webmaster-plastilina.webp",
    color: "#2DD4BF",
    numero: "0003",
    seEncarga: [
      "Publica y corrige en tu WordPress lo que le pides",
      "Actualiza plugins y vigila que el sitio no se caiga",
      "Mide qué tan rápido carga y arregla lo que lo frena",
    ],
    regla: "Lo que toca tu sitio, lo hace con tu permiso.",
  },
  {
    slug: "administrativo",
    departamento: "Financiero",
    puesto: "Factura y cobra",
    imagen: "/avatares/whatsapp/05.webp",
    color: "#4ADE80",
    numero: "0004",
    seEncarga: [
      "Trabaja sobre tu cuenta de Alegra, nómina incluida",
      "Te dice quién te debe, cuánto y desde cuándo",
      "Responde con tablas claras, no con rodeos",
    ],
    regla: "Las cifras salen de tu contabilidad, no de su imaginación.",
  },
];

export const DISENADOR = {
  departamento: "Diseño",
  imagen: "/avatares/whatsapp/03.webp",
  color: "#A78BFA",
} as const;

export type Momento = {
  readonly hora: string;
  /** Minutos desde las 00:00, para mover las agujas del reloj. */
  readonly minutos: number;
  readonly quien: string;
  readonly imagen: string;
  readonly color: string;
  readonly texto: string;
  readonly forma: "burbuja" | "aviso" | "permiso" | "nota" | "factura" | "cierre";
};

const [COM, MKT, WEB, FIN] = EQUIPO;

export const UN_DIA: readonly Momento[] = [
  {
    hora: "07:52",
    minutos: 7 * 60 + 52,
    quien: COM.departamento,
    imagen: COM.imagen,
    color: COM.color,
    texto: "Seis clientes escribieron antes de abrir. Los seis ya tienen respuesta.",
    forma: "burbuja",
  },
  {
    hora: "09:14",
    minutos: 9 * 60 + 14,
    quien: WEB.departamento,
    imagen: WEB.imagen,
    color: WEB.color,
    texto: "Actualizó tres plugins y comprobó que la web sigue en pie.",
    forma: "aviso",
  },
  {
    hora: "10:37",
    minutos: 10 * 60 + 37,
    quien: MKT.departamento,
    imagen: MKT.imagen,
    color: MKT.color,
    texto: "Una campaña lleva nueve días gastando sin traer clientes. Te pide permiso para pausarla.",
    forma: "permiso",
  },
  {
    hora: "12:20",
    minutos: 12 * 60 + 20,
    quien: COM.departamento,
    imagen: COM.imagen,
    color: COM.color,
    texto: "Dejó agendadas cuatro citas para mañana. Una pidió hablar contigo; ya te la pasó.",
    forma: "nota",
  },
  {
    hora: "15:05",
    minutos: 15 * 60 + 5,
    quien: WEB.departamento,
    imagen: WEB.imagen,
    color: WEB.color,
    texto: "Le pidió al Diseñador el banner de la promo y lo publicó en la portada.",
    forma: "aviso",
  },
  {
    hora: "16:48",
    minutos: 16 * 60 + 48,
    quien: FIN.departamento,
    imagen: FIN.imagen,
    color: FIN.color,
    texto: "Revisó la cartera en Alegra: tres clientes deben más de 30 días. Te dejó la tabla.",
    forma: "factura",
  },
  {
    hora: "18:30",
    minutos: 18 * 60 + 30,
    quien: "Tú",
    imagen: "",
    color: "#0080FF",
    texto: "Aprobaste dos cosas desde el celular, entre una reunión y otra. Eso fue todo.",
    forma: "cierre",
  },
];

export const CINTA_ARRIBA: readonly string[] = [
  "Comunicaciones respondió a Laura por su pedido",
  "Webmaster dejó la web cargando en 1,8 s",
  "Marketing encontró una campaña que no vende",
  "Financiero te listó quién debe",
  "Comunicaciones agendó una cita para el sábado",
  "Webmaster hizo copia del sitio antes de tocarlo",
];

export const CINTA_ABAJO: readonly string[] = [
  "sin sueldos",
  "sin horario",
  "sin vacaciones",
  "sin horas extra",
  "con tu visto bueno",
  "en español",
];
