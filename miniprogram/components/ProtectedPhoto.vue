<template><view class="photo-frame" @tap="preview"><image v-if="source" :src="source" :mode="mode" /><text v-else @tap.stop="load">{{ loading ? '加载中…' : failure + '，点此重试' }}</text></view></template>
<script>
import { photoUrl } from '../utils/photo.js'
export default {
  props: { url: { type:String, required:true }, mode: { type:String, default:'aspectFill' } },
  data() { return { source:'', loading:false, generation:0, failure:'照片加载失败' } },
  watch: { url: { immediate:true, handler() { this.load() } } },
  beforeUnmount() { this.generation++; this.clear() },
  methods: {
    clear() { if(typeof URL !== 'undefined' && this.source.startsWith('blob:')) URL.revokeObjectURL(this.source); this.source='' },
    async load() { const current=++this.generation;this.clear();const url=photoUrl(this.url);if(!url)return;this.loading=true;this.failure='照片加载失败';uni.downloadFile({ url, header:{Authorization:`Bearer ${uni.getStorageSync('access_token') || ''}`}, timeout:15000,success:res=>{if(current===this.generation){if(res.statusCode===200)this.source=res.tempFilePath;else if(res.statusCode===404)this.failure='原文件缺失或不可访问'}},complete:()=>{if(current===this.generation)this.loading=false} }) },
    preview() { if(this.source)uni.previewImage({ urls:[this.source] }) }
  }
}
</script>
<style scoped>.photo-frame{aspect-ratio:1;border-radius:16rpx;background:#ece8df;overflow:hidden;display:flex;align-items:center;justify-content:center}.photo-frame image{width:100%;height:100%}.photo-frame text{padding:12rpx;text-align:center;color:#716b60;font-size:20rpx;line-height:1.7}</style>
