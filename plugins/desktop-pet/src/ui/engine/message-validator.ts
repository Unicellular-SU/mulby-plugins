/**
 * 子窗口 IPC 消息 schema 校验工具。
 *
 * 由于 mulby 平台 onChildMessage 不暴露发送方 windowId/pluginId，业务层只能依赖
 * 严格的 payload schema 来抵御伪造。每个 channel 都对应一个 validator。
 */

import type { GeoContext, PetPersonality, PetReminder } from './ai-chat'

export function validateGeoUpdated(payload: unknown): GeoContext | null | undefined {
  if (payload === null) return null
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>
  const lat = typeof p.latitude === 'number' ? p.latitude : Number(p.latitude)
  const lon = typeof p.longitude === 'number' ? p.longitude : Number(p.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined
  const geo: GeoContext = { latitude: lat, longitude: lon }
  if (typeof p.city === 'string' && p.city.length <= 80) geo.city = p.city
  if (typeof p.region === 'string' && p.region.length <= 80) geo.region = p.region
  if (typeof p.weather === 'string' && p.weather.length <= 16) geo.weather = p.weather
  const temp = typeof p.temperature === 'number' ? p.temperature : Number(p.temperature)
  if (Number.isFinite(temp)) geo.temperature = temp
  return geo
}

const TRAIT_VALUES = new Set(['lively', 'quiet', 'sarcastic', 'warm', 'custom'])
const FREQUENCY_VALUES = new Set(['high', 'medium', 'low', 'click-only'])

function normalizeReminder(raw: unknown): PetReminder | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.slice(0, 64) : ''
  const label = typeof r.label === 'string' ? r.label.slice(0, 60) : ''
  const hour = Number(r.hour)
  const minute = Number(r.minute)
  if (!id || !label) return null
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  return { id, label, hour, minute, enabled: r.enabled !== false }
}

export function normalizePersonality(raw: unknown, fallback: PetPersonality): PetPersonality {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const r = raw as Record<string, unknown>
  const trait = typeof r.trait === 'string' && TRAIT_VALUES.has(r.trait) ? (r.trait as PetPersonality['trait']) : fallback.trait
  const frequency = typeof r.frequency === 'string' && FREQUENCY_VALUES.has(r.frequency)
    ? (r.frequency as PetPersonality['frequency'])
    : fallback.frequency
  const triggersRaw = (r.triggers && typeof r.triggers === 'object') ? r.triggers as Record<string, unknown> : {}
  const triggers = {
    idle: triggersRaw.idle === false ? false : (triggersRaw.idle === true ? true : fallback.triggers.idle),
    typing: triggersRaw.typing === false ? false : (triggersRaw.typing === true ? true : fallback.triggers.typing),
    morning: triggersRaw.morning === false ? false : (triggersRaw.morning === true ? true : fallback.triggers.morning),
    lateNight: triggersRaw.lateNight === false ? false : (triggersRaw.lateNight === true ? true : fallback.triggers.lateNight),
    clipboard: triggersRaw.clipboard === true ? true : false,
    mousePattern: triggersRaw.mousePattern === false ? false : (triggersRaw.mousePattern === true ? true : fallback.triggers.mousePattern),
  }
  const reminders = Array.isArray(r.reminders)
    ? (r.reminders as unknown[]).map(normalizeReminder).filter((x): x is PetReminder => !!x).slice(0, 20)
    : fallback.reminders
  const pomodoroMinutes = (() => {
    const n = Number(r.pomodoroMinutes)
    return Number.isFinite(n) && n >= 1 && n <= 240 ? Math.round(n) : fallback.pomodoroMinutes
  })()
  const customPrompt = typeof r.customPrompt === 'string' ? r.customPrompt.slice(0, 1500) : fallback.customPrompt
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 20) : fallback.name
  const model = typeof r.model === 'string' ? r.model.slice(0, 200) : fallback.model
  const birthday = typeof r.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.birthday) ? r.birthday : fallback.birthday
  return {
    name,
    trait,
    customPrompt,
    model,
    frequency,
    pomodoroMinutes,
    triggers,
    reminders,
    birthday,
  }
}

export function validateChatMessage(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.slice(0, 500)
  if (payload && typeof payload === 'object') {
    const t = (payload as Record<string, unknown>).text
    if (typeof t === 'string') return t.slice(0, 500)
  }
  return null
}
