'use client';

import { createClient } from '@insforge/sdk';

/**
 * Cliente y constantes compartidas de InsForge.
 *
 * Este archivo centraliza la conexion a InsForge.
 * Degine los catalogos usados por la UI .
 */

export const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL,
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
});

export const STATUSES = [
  ['idea', 'Idea'],
  ['planning', 'Planificacion'],
  ['in_progress', 'En progreso'],
  ['blocked', 'Bloqueado'],
  ['in_review', 'En revision'],
  ['completed', 'Completado'],
  ['archived', 'Archivado']
];

export const PRIORITIES = [
  ['high', 'Alta'],
  ['medium', 'Media'],
  ['low', 'Baja']
];

export const FREQUENCIES = [
  ['daily', 'Diaria'],
  ['weekly', 'Semanal'],
  ['monthly', 'Mensual'],
  ['yearly', 'Anual'],
  ['specific_weekday', 'Dia especifico']
];

export function labelFrom(options, value) {
  return options.find(([key]) => key === value)?.[1] ?? value;
}
