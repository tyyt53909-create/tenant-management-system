<template><image class="q-icon" :src="source" mode="aspectFit" :style="{ width: size + 'rpx', height: size + 'rpx' }" /></template>
<script>
export default {
  props: { name: { type: String, default: 'home' }, size: { type: Number, default: 40 }, active: { type: Boolean, default: false } },
  computed: { source() { const suffix = this.active && ['home', 'bill', 'repair', 'user'].includes(this.name) ? '-active' : ''; return `/static/${this.name}${suffix}.png` } }
}
</script>
<style scoped>.q-icon{display:block;flex-shrink:0}</style>
