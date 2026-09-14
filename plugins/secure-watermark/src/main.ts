/// <reference path="./types/mulby.d.ts" />
import path from 'node:path'
declare const mulby:any
let pendingPaths:string[]=[]
export function onLoad(){} export function onUnload(){} export function onEnable(){} export function onDisable(){}
export async function run(context:any){ pendingPaths=(context.attachments??[]).map((a:any)=>a.path).filter((p:any)=>typeof p==='string') }
export const rpc={
 async getPendingInit(){const p=[...pendingPaths];pendingPaths=[];return {paths:p}},
 async previewFile(filePath:string){try{const b=await mulby.filesystem.readFile(filePath);const ext=path.extname(filePath).toLowerCase();const mime=({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.bmp':'image/bmp'} as any)[ext]||'image/png';return {data:Buffer.from(b).toString('base64'),mimeType:mime}}catch(e:any){return {error:e.message}}},
 async writeFile(filePath:string,base64:string){try{await mulby.filesystem.writeFile(filePath,Buffer.from(base64,'base64'));return {ok:true}}catch(e:any){return {error:e.message}}}
}
export default {onLoad,onUnload,onEnable,onDisable,run,rpc}
