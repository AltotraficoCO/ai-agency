import { describe, expect, it } from 'vitest';
import { CONFIG_COBRO_POR_DEFECTO } from '@strappy/core/recargas';
import { aplicarClaveDeCartera, claveDePlataforma, cifrar, leerAjustesDeCobro } from '../src/adapters/index.js';

const env = { APP_ENCRYPTION_KEY: 'clave-de-prueba-de-mas-de-16' } as NodeJS.ProcessEnv;
const secretos = { privada: 'prv_test_a', integridad: 'test_integrity_b', eventos: 'test_events_c' };

function consulta(filas: unknown[]) {
  return async () => ({ rows: filas });
}

describe('ajustes de la plataforma', () => {
  it('lo que cifra el panel lo descifra el worker: comparten APP_ENCRYPTION_KEY', async () => {
    const encrypted = cifrar(JSON.stringify(secretos), claveDePlataforma(env));
    const { llaves } = await leerAjustesDeCobro(
      consulta([{ key: 'wompi', value: { publica: 'pub_test_z' }, encrypted }]),
      env,
    );
    expect(llaves).toEqual({ publica: 'pub_test_z', ...secretos });
  });

  it('sin nada guardado usa las variables de entorno y los valores por defecto', async () => {
    const a = await leerAjustesDeCobro(consulta([]), { WOMPI_PRIVATE_KEY: 'prv_test_env' } as NodeJS.ProcessEnv);
    expect(a.llaves.privada).toBe('prv_test_env');
    expect(a.config).toEqual(CONFIG_COBRO_POR_DEFECTO);
  });

  it('si no se puede descifrar, no hay llaves: mejor no cobrar', async () => {
    const encrypted = cifrar(JSON.stringify(secretos), claveDePlataforma(env));
    const { llaves } = await leerAjustesDeCobro(
      consulta([{ key: 'wompi', value: {}, encrypted }]),
      { APP_ENCRYPTION_KEY: 'otra-clave-distinta-de-16' } as NodeJS.ProcessEnv,
    );
    expect(llaves.privada).toBe('');
  });

  it('la clave de la cartera guardada en el panel manda sobre la del entorno', async () => {
    const encrypted = cifrar(JSON.stringify({ openrouter: 'sk-or-panel' }), claveDePlataforma(env));
    const { cartera } = await leerAjustesDeCobro(consulta([{ key: 'modelos', value: {}, encrypted }]), {
      ...env,
      OPENROUTER_API_KEY: 'sk-or-env',
    } as NodeJS.ProcessEnv);
    expect(cartera).toEqual({ openrouter: 'sk-or-panel', origen: 'panel' });
  });

  it('sin clave en el panel vale la del entorno, y sin ninguna se dice', async () => {
    const conEnv = await leerAjustesDeCobro(consulta([]), { OPENROUTER_API_KEY: 'sk-or-env' } as NodeJS.ProcessEnv);
    expect(conEnv.cartera).toEqual({ openrouter: 'sk-or-env', origen: 'entorno' });
    const sinNada = await leerAjustesDeCobro(consulta([]), {} as NodeJS.ProcessEnv);
    expect(sinNada.cartera).toEqual({ openrouter: '', origen: 'ninguno' });
  });

  it('aplicar la clave del panel la deja en el entorno, y olvidarla devuelve la del .env', async () => {
    const entorno = { OPENROUTER_API_KEY: 'sk-or-env' } as NodeJS.ProcessEnv;
    expect(aplicarClaveDeCartera({ openrouter: 'sk-or-panel', origen: 'panel' }, entorno)).toBe(true);
    expect(entorno['OPENROUTER_API_KEY']).toBe('sk-or-panel');
    expect(aplicarClaveDeCartera({ openrouter: 'sk-or-panel', origen: 'panel' }, entorno)).toBe(false);

    // Con el panel ya puesto, el respaldo sigue siendo la del .env, no la del panel.
    const sinPanel = await leerAjustesDeCobro(consulta([]), entorno);
    expect(sinPanel.cartera).toEqual({ openrouter: 'sk-or-env', origen: 'entorno' });
    expect(aplicarClaveDeCartera(sinPanel.cartera, entorno)).toBe(true);
    expect(entorno['OPENROUTER_API_KEY']).toBe('sk-or-env');
  });

  it('sin clave en el .env, olvidar la del panel deja el entorno vacío', () => {
    const entorno = {} as NodeJS.ProcessEnv;
    aplicarClaveDeCartera({ openrouter: 'sk-or-panel', origen: 'panel' }, entorno);
    expect(aplicarClaveDeCartera({ openrouter: '', origen: 'ninguno' }, entorno)).toBe(true);
    expect('OPENROUTER_API_KEY' in entorno).toBe(false);
  });
});
