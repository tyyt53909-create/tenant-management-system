<template>
  <view class="home-skeleton" role="status">
    <view class="skeleton-line" />
    <view class="skeleton-line skeleton-line-short" />
    <text class="loading-label">{{ label }}</text>
  </view>
</template>

<script>
export default {
  props: { label: { type: String, required: true } }
}
</script>

<style scoped>
.home-skeleton { padding: 28rpx 0; }
.skeleton-line { width: 68%; height: 22rpx; border-radius: 12rpx; background: #ede8de; }
.skeleton-line-short { width: 42%; height: 16rpx; margin-top: 16rpx; }
.loading-label { display: block; margin-top: 16rpx; font-size: 22rpx; color: #68665e; }
</style>
