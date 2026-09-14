export function useMulby(id:string){return {host:{call:(method:string,...args:any[])=>window.mulby?.host?.call(id,method,...args)}}}
