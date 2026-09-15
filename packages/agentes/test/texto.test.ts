/**
 * La última red antes de que un texto llegue al cliente.
 *
 * Importa desde que los agentes hablan con servicios de terceros: sus
 * adaptadores meten el cuerpo de la respuesta dentro de los errores —es lo
 * único que permite entender un 403 sin entrar al servidor de nadie— y ese
 * cuerpo puede traer de vuelta el token con el que se llamó.
 */
import { describe, expect, it } from "vitest";
import { crearTapadera } from "../src/texto.js";

describe("tapar credenciales", () => {
  it("tapa los secretos que el worker conoce", () => {
    const tapar = crearTapadera(["refresco-del-cliente"]);
    expect(tapar("Google rechazó el token refresco-del-cliente")).toBe("Google rechazó el token ***");
  });

  it("tapa una cabecera de autenticación aunque nadie la conociera", () => {
    const tapar = crearTapadera([]);
    expect(tapar('{"error":"Authorization: Bearer EAAG9ZC0xyzabc123"}')).not.toContain("EAAG9ZC0xyzabc123");
    expect(tapar("Access-Token: 0f8e7d6c5b4a3928")).not.toContain("0f8e7d6c5b4a3928");
  });

  it("tapa el secreto que viaja dentro de una URL", () => {
    const tapar = crearTapadera([]);
    const limpio = tapar("falló https://business-api.tiktok.com/x?app_id=7&secret=abcdef123456&page=2");
    expect(limpio).not.toContain("abcdef123456");
    // Lo que no es secreto se queda: sin el resto de la URL no se entiende el error.
    expect(limpio).toContain("page=2");
  });

  it("ignora los secretos demasiado cortos", () => {
    // Tapar una cadena de tres letras llenaría de asteriscos el texto entero.
    const tapar = crearTapadera(["abc"]);
    expect(tapar("abcdario")).toBe("abcdario");
  });

  it("deja intacto un texto normal", () => {
    const tapar = crearTapadera(["token-larguisimo"]);
    expect(tapar("Subí el presupuesto de «Promo» de 30.000 a 50.000 al día.")).toBe(
      "Subí el presupuesto de «Promo» de 30.000 a 50.000 al día.",
    );
  });
});
