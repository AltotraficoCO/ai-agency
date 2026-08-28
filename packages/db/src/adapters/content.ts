/**
 * Traducción entre el contenido normalizado del motor (`MessageContent`) y las
 * columnas `messages.content_type` + `messages.content` del esquema.
 *
 * Es la única pieza que conoce las dos formas. El motor no sabe de columnas y
 * el esquema no sabe de uniones discriminadas de TypeScript.
 */
import type { MessageContent } from '@strappy/core';
import type { JsonObject } from '../types.js';

export type ContenidoPersistido = {
  readonly contentType: string;
  readonly content: JsonObject;
};

export function aColumnas(content: MessageContent): ContenidoPersistido {
  switch (content.kind) {
    case 'text':
      return { contentType: 'text', content: { text: content.text } };
    case 'image':
      return {
        contentType: 'image',
        content: { media_id: content.mediaId, caption: content.caption ?? null },
      };
    case 'audio':
      return {
        contentType: 'audio',
        content: {
          media_id: content.mediaId,
          duration_ms: content.durationMs ?? null,
          transcript: content.transcript ?? null,
        },
      };
    case 'video':
      return {
        contentType: 'video',
        content: { media_id: content.mediaId, caption: content.caption ?? null },
      };
    case 'document':
      return {
        contentType: 'document',
        content: { media_id: content.mediaId, filename: content.filename ?? null },
      };
    case 'location':
      return {
        contentType: 'location',
        content: {
          latitude: content.latitude,
          longitude: content.longitude,
          label: content.label ?? null,
        },
      };
    case 'buttons':
      return {
        contentType: 'interactive',
        content: { text: content.text, options: content.options },
      };
    case 'unsupported':
      return { contentType: 'unsupported', content: { described_as: content.describedAs } };
  }
}

export function desdeColumnas(contentType: string, content: unknown): MessageContent {
  const c = (content ?? {}) as Record<string, unknown>;
  const texto = (valor: unknown, porDefecto = ''): string =>
    typeof valor === 'string' ? valor : porDefecto;

  switch (contentType) {
    case 'text':
    case 'system':
      return { kind: 'text', text: texto(c['text']) };
    case 'image':
      return {
        kind: 'image',
        mediaId: texto(c['media_id']),
        ...(typeof c['caption'] === 'string' ? { caption: c['caption'] } : {}),
      };
    case 'audio':
      return {
        kind: 'audio',
        mediaId: texto(c['media_id']),
        ...(typeof c['duration_ms'] === 'number' ? { durationMs: c['duration_ms'] } : {}),
        ...(typeof c['transcript'] === 'string' ? { transcript: c['transcript'] } : {}),
      };
    case 'video':
      return {
        kind: 'video',
        mediaId: texto(c['media_id']),
        ...(typeof c['caption'] === 'string' ? { caption: c['caption'] } : {}),
      };
    case 'document':
      return {
        kind: 'document',
        mediaId: texto(c['media_id']),
        ...(typeof c['filename'] === 'string' ? { filename: c['filename'] } : {}),
      };
    case 'location':
      return {
        kind: 'location',
        latitude: Number(c['latitude'] ?? 0),
        longitude: Number(c['longitude'] ?? 0),
        ...(typeof c['label'] === 'string' ? { label: c['label'] } : {}),
      };
    case 'interactive':
      return {
        kind: 'buttons',
        text: texto(c['text']),
        options: Array.isArray(c['options']) ? (c['options'] as { id: string; label: string }[]) : [],
      };
    default:
      // Un adjunto que no sabemos representar se DESCRIBE, nunca se omite: si
      // desaparece, el agente responde como si la persona no hubiera enviado nada.
      return { kind: 'unsupported', describedAs: texto(c['described_as'], contentType) };
  }
}
