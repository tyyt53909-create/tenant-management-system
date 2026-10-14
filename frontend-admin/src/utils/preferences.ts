export interface InterfacePreferences {compact:boolean;reduceMotion:boolean}
export const DEFAULT_PREFERENCES:InterfacePreferences={compact:false,reduceMotion:false};
export function parsePreferences(raw:string|null):InterfacePreferences{
  try{const data=raw?JSON.parse(raw):{};return {compact:data?.compact===true,reduceMotion:data?.reduceMotion===true};}
  catch{return {...DEFAULT_PREFERENCES};}
}
export const PREFERENCES_KEY='qiju-interface-preferences-v3';
