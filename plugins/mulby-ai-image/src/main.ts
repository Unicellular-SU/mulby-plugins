/// <reference path="./types/mulby.d.ts" />
declare const mulby: any

let currentContext: BackendPluginContext | null = null;
let resolveContextReady: ((ctx: BackendPluginContext) => void) | null = null;

export function onLoad() {}
export function onUnload() {}
export function onEnable() {}
export function onDisable() {}

export async function run(context: BackendPluginContext) {
  currentContext = context;
  if (resolveContextReady) {
    resolveContextReady(context);
    resolveContextReady = null;
  }
}

export const rpc = {
  async getContext() {
    if (currentContext) return currentContext;
    return new Promise((resolve) => {
      resolveContextReady = resolve;
    });
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
