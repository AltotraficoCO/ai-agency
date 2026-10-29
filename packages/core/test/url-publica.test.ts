import { describe, expect, it } from "vitest";
import { comprobarUrlPublica, esDireccionPrivada, fetchPublico, UrlNoPublicaError } from "../src/red/url-publica.js";

const publica = async () => ["93.184.216.34"];

describe("esDireccionPrivada", () => {
  it("reconoce loopback, privadas, enlace local y metadatos", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(esDireccionPrivada(ip), ip).toBe(true);
    }
  });
  it("deja pasar direcciones de internet", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(esDireccionPrivada(ip), ip).toBe(false);
    }
  });
});

describe("comprobarUrlPublica", () => {
  it("rechaza esquemas, puertos y nombres internos sin resolver nada", async () => {
    await expect(comprobarUrlPublica("ftp://ejemplo.com/")).rejects.toBeInstanceOf(UrlNoPublicaError);
    await expect(comprobarUrlPublica("http://localhost/")).rejects.toBeInstanceOf(UrlNoPublicaError);
    await expect(comprobarUrlPublica("http://metadata.google.internal/")).rejects.toBeInstanceOf(UrlNoPublicaError);
    await expect(comprobarUrlPublica("http://ejemplo.com:5432/")).rejects.toBeInstanceOf(UrlNoPublicaError);
    await expect(comprobarUrlPublica("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(UrlNoPublicaError);
    await expect(comprobarUrlPublica("http://[::1]/")).rejects.toBeInstanceOf(UrlNoPublicaError);
  });

  it("rechaza un dominio que resuelve a una dirección privada, aunque solo sea una", async () => {
    const resolver = async () => ["93.184.216.34", "10.0.0.5"];
    await expect(comprobarUrlPublica("https://trampa.example/", { resolver })).rejects.toThrow(/privada/);
  });

  it("acepta un dominio público", async () => {
    const r = await comprobarUrlPublica("https://ejemplo.com/pagina?x=1", { resolver: publica });
    expect(r.url.hostname).toBe("ejemplo.com");
    expect(r.direcciones).toEqual(["93.184.216.34"]);
  });
});

describe("fetchPublico", () => {
  it("sigue redirecciones comprobando cada salto y corta la que va hacia dentro", async () => {
    const pedidas: string[] = [];
    const fetch = (async (entrada: string | URL | Request) => {
      const url = String(entrada);
      pedidas.push(url);
      if (url === "https://publico.example/img.png") {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
      }
      return new Response("ok");
    }) as typeof globalThis.fetch;

    await expect(fetchPublico("https://publico.example/img.png", { fetch, resolver: publica })).rejects.toBeInstanceOf(
      UrlNoPublicaError,
    );
    expect(pedidas).toEqual(["https://publico.example/img.png"]);
  });

  it("devuelve la respuesta final de una cadena de redirecciones públicas", async () => {
    const fetch = (async (entrada: string | URL | Request) => {
      const url = String(entrada);
      if (url === "https://a.example/") return new Response(null, { status: 301, headers: { location: "/b" } });
      if (url === "https://a.example/b") return new Response(null, { status: 302, headers: { location: "https://c.example/" } });
      return new Response("final", { status: 200 });
    }) as typeof globalThis.fetch;
    const r = await fetchPublico("https://a.example/", { fetch, resolver: publica });
    expect(await r.text()).toBe("final");
  });
});
