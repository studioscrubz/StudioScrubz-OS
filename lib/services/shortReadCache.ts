import {getSupabaseClient} from "@/lib/supabase/client";

// Short-lived, per-authenticated-user read-through cache. Do not cache failed reads.
// Write paths evict related keys; short TTL covers changes made on other devices.
const MAX_AGE_MS=5_000;
type Entry={until:number;value:unknown};
const saved=new Map<string,Entry>();
const pending=new Map<string,Promise<unknown>>();
const revisions=new Map<string,number>([["clients:",0],["properties:",0],["property-clients",0]]);
let subscribed=false;
let sessionGeneration=0;
function ensureAuthInvalidation(){
 if(subscribed||typeof window==="undefined")return;
 subscribed=true;
 getSupabaseClient().auth.onAuthStateChange((event)=>{
  if(event==="SIGNED_OUT"||event==="SIGNED_IN"||event==="USER_UPDATED"){
   sessionGeneration++;
   saved.clear();pending.clear();
  }
 });
}
export function invalidateShortReadCache(prefix:string){
 for(const key of [...saved.keys()])if(key.includes(`:${prefix}`))saved.delete(key);
 for(const key of [...pending.keys()])if(key.includes(`:${prefix}`))pending.delete(key);
 revisions.set(prefix,(revisions.get(prefix)??0)+1);
}
export async function shortCachedRead<T>(key:string,load:()=>Promise<T>):Promise<T>{
 if(typeof window==="undefined")return load();
 ensureAuthInvalidation();
 const {data:{session}}=await getSupabaseClient().auth.getSession();
 const userId=session?.user?.id;
 if(!userId)return load();
 const cacheKey=`${userId}:${key}`;
 const hit=saved.get(cacheKey);
 if(hit&&hit.until>Date.now())return hit.value as T;
 const existing=pending.get(cacheKey);
 if(existing)return existing as Promise<T>;
 const generation=sessionGeneration;
 const prefixVersions=[...revisions].filter(([prefix])=>key.startsWith(prefix));
 const promise=load().then(value=>{
  if(sessionGeneration===generation && prefixVersions.every(([prefix,version])=>revisions.get(prefix)===version))
   saved.set(cacheKey,{until:Date.now()+MAX_AGE_MS,value});
  return value;
 }).finally(()=>{
  if(pending.get(cacheKey)===promise)pending.delete(cacheKey);
 });
 pending.set(cacheKey,promise);
 return promise;
}
