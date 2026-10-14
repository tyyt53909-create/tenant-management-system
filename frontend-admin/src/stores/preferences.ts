import { defineStore } from 'pinia';
import { ref,watch } from 'vue';
import { DEFAULT_PREFERENCES,parsePreferences,PREFERENCES_KEY } from '@/utils/preferences';
export const usePreferencesStore=defineStore('preferences',()=>{
  let saved={...DEFAULT_PREFERENCES};try{saved=parsePreferences(localStorage.getItem(PREFERENCES_KEY));}catch{}
  const compact=ref(saved.compact);const reduceMotion=ref(saved.reduceMotion);const saveError=ref('');
  watch([compact,reduceMotion],()=>{
    saveError.value='';
    try{localStorage.setItem(PREFERENCES_KEY,JSON.stringify({compact:compact.value,reduceMotion:reduceMotion.value}));}
    catch{saveError.value='界面已切换，但浏览器未允许保存偏好。';}
  });
  function reset(){compact.value=false;reduceMotion.value=false;}
  return {compact,reduceMotion,saveError,reset};
});
