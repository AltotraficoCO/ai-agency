/**
 * Composición de todos los puertos sobre un mismo ámbito de tenant.
 *
 * Existe para que ningún punto de la aplicación tenga que acordarse de montar
 * ocho adaptadores en el orden correcto. Lo que NO monta —el modelo de lenguaje
 * y el conjunto de herramientas— se queda fuera a propósito: dependen del SDK
 * de IA y del registro de herramientas, y este paquete no debe arrastrarlos.
 */
import type {
  AgentRunStore,
  AgentStore,
  ConversationLockPort,
  ConversationStore,
  CreditLedgerPort,
  OutboundQueue,
  RateTable,
  ModelTable,
} from '@strappy/core';
import type { ContactPort, HandoverPort, SchedulingPort, SecretResolver, HttpPort } from '@strappy/tools';
import type { ConocimientoDbPort } from '@strappy/rag';
import type { TenantScope } from '../client.js';
import { crearConversationStore } from './conversations.js';
import { crearAgentStore, crearPromptSpecFor } from './agents.js';
import { crearAgentRunStore, type OpcionesAgentRun } from './agent-runs.js';
import { crearOutboundQueue } from './outbound.js';
import { crearConversationLock } from './lock.js';
import { cargarTarifas, crearCreditLedger } from './credits.js';
import { cargarTablaDeModelos } from './model-table.js';
import { crearConocimientoDb, crearModelTiersPort } from './knowledge.js';
import { crearContactPort } from './contacts.js';
import { crearHandoverPort } from './handover.js';
import { crearSchedulingPort } from './scheduling.js';
import { crearSecretResolver } from './secrets.js';
import { crearHttpPort, hostsPermitidos } from './http.js';

export type PuertosDeBase = {
  readonly conversations: ConversationStore;
  readonly agents: AgentStore;
  readonly runs: AgentRunStore;
  readonly outbound: OutboundQueue;
  readonly ledger: CreditLedgerPort;
  readonly lock: ConversationLockPort;
  /**
   * Las tablas del conocimiento. El `KnowledgePort` que consume el motor lo
   * aporta la clase `Cerebro` de `@strappy/rag`, montada sobre esto.
   */
  readonly conocimiento: ConocimientoDbPort;
  readonly modelTiers: ReturnType<typeof crearModelTiersPort>;
  readonly promptSpecFor: ReturnType<typeof crearPromptSpecFor>;
  readonly rates: RateTable;
  readonly modelTable: ModelTable;
  readonly herramientas: {
    readonly contacts: ContactPort;
    readonly handover: HandoverPort;
    readonly scheduling: SchedulingPort;
    readonly secrets: SecretResolver;
    readonly http: HttpPort;
  };
};

export type OpcionesPuertos = {
  encryptionKey?: string;
  run?: OpcionesAgentRun;
};

export async function crearPuertos(
  scope: TenantScope,
  opciones: OpcionesPuertos = {},
): Promise<PuertosDeBase> {
  const [rates, modelTable, hosts] = await Promise.all([
    cargarTarifas(scope),
    cargarTablaDeModelos(scope),
    hostsPermitidos(scope),
  ]);

  return {
    conversations: crearConversationStore(scope),
    agents: crearAgentStore(scope),
    runs: crearAgentRunStore(scope, opciones.run ?? {}),
    outbound: crearOutboundQueue(scope),
    ledger: crearCreditLedger(scope),
    lock: crearConversationLock(scope),
    conocimiento: crearConocimientoDb(scope),
    modelTiers: crearModelTiersPort(scope),
    promptSpecFor: crearPromptSpecFor(scope),
    rates,
    modelTable,
    herramientas: {
      contacts: crearContactPort(scope),
      handover: crearHandoverPort(scope),
      scheduling: crearSchedulingPort(scope),
      secrets: crearSecretResolver(
        scope,
        opciones.encryptionKey ? { encryptionKey: opciones.encryptionKey } : {},
      ),
      http: crearHttpPort(hosts),
    },
  };
}
