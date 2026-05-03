/// <reference path="./types/mulby.d.ts" />

import {
  getDateInfo,
  getAlmanac,
  getFestivals,
  searchNextFestival,
  getShichen,
} from './shared/calendar-core.js'

export function onLoad(context: any) {
  const { tools } = context.api

  tools.register('get_date_info', async (args: any) => {
    return getDateInfo(args)
  })

  tools.register('get_almanac', async (args: any) => {
    return getAlmanac(args)
  })

  tools.register('get_festivals', async (args: any) => {
    return getFestivals(args)
  })

  tools.register('search_next_festival', async (args: any) => {
    return searchNextFestival(args)
  })

  tools.register('get_shichen', async (args: any) => {
    return getShichen(args)
  })
}

export function onUnload() {}
export function onEnable() {}
export function onDisable() {}

export async function run(_context: any) {}

export default { onLoad, onUnload, onEnable, onDisable, run }
