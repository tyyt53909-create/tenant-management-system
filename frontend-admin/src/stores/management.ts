import { defineStore } from 'pinia';
import { ref } from 'vue';
import request from '@/utils/request';
import { useUserStore } from './user';
import type { ManagementSnapshot } from '@/utils/managementMetrics';

export const useManagementStore=defineStore('management',()=>{
  const snapshot=ref<ManagementSnapshot|null>(null);const loading=ref(false);const error=ref('');
  let loadedAt=0;let owner='';let pending:Promise<void>|null=null;
  async function load(force=false){
    const userStore = useUserStore();
    if(!userStore.token){snapshot.value=null;loadedAt=0;owner='';return;}
    const actor=userStore.user?.id || owner;
    if(owner!==actor){snapshot.value=null;loadedAt=0;owner=actor;}
    if(pending)return pending;
    if(!force&&snapshot.value&&Date.now()-loadedAt<30000)return;
    loading.value=true;error.value='';
    pending=request.get('/dashboard/management-summary',{silentError:true}).then((data:any)=>{
      if(typeof data.ownerId!=='string'||typeof data.generatedAt!=='string')throw new Error('摘要响应格式不正确');
      const current=userStore.user?.id;
      if(userStore.token && (!current||data.ownerId===current)){snapshot.value=data;owner=data.ownerId;loadedAt=Date.now();}
    }).catch(()=>{error.value='摘要未能更新，请检查连接后重试。';}).finally(()=>{loading.value=false;pending=null;});
    return pending;
  }
  return {snapshot,loading,error,load};
});
