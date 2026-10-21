<template>
  <view class="space-map">
    <view class="map-heading">
      <text class="map-title">{{ title }}</text>
      <text v-if="subtitle" class="map-subtitle">{{ subtitle }}</text>
    </view>
    <view v-for="floor in floors" :key="floor.floor" class="floor-row">
      <text class="floor-label">{{ floor.floor }}楼</text>
      <view class="room-grid">
        <view v-for="room in floor.rooms" :key="room.id"
          :class="['room-tile', { active: room.id === selectedRoomId, occupied: mode === 'tenant' }]"
          @tap="$emit('select', room.id)">
          <text>{{ room.roomNumber }}</text>
        </view>
      </view>
    </view>
    <view v-if="!floors.length" class="map-empty">暂无可显示的位置</view>
    <text class="map-legend">{{ mode === 'tenant' ? '仅标示您的居所' : '仅显示待清洁与清洁中的任务房间' }}</text>
  </view>
</template>

<script>
export default {
  props: {
    rooms: { type: Array, default: () => [] },
    mode: { type: String, default: 'cleaner' },
    selectedRoomId: { type: String, default: '' },
    title: { type: String, default: '楼层位置图' },
    subtitle: { type: String, default: '' }
  },
  computed: {
    floors() {
      const grouped = new Map()
      this.rooms.forEach(room => {
        const floor = Number(room.floor)
        if (!Number.isFinite(floor)) return
        if (!grouped.has(floor)) grouped.set(floor, [])
        grouped.get(floor).push(room)
      })
      return [...grouped.entries()].sort((a, b) => a[0] - b[0])
        .map(([floor, rooms]) => ({ floor, rooms }))
    }
  }
}
</script>

<style scoped>
.space-map{box-sizing:border-box;width:100%;min-width:0;padding:24rpx;border:1rpx solid #dfe6df;border-radius:16rpx;background:#fff;margin-bottom:24rpx}.map-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12rpx;margin-bottom:20rpx}.map-title{font-size:28rpx;font-weight:650;color:#1d3029}.map-subtitle,.map-legend,.map-empty{font-size:22rpx;color:#758078}.floor-row{display:flex;align-items:flex-start;gap:14rpx;margin:14rpx 0}.floor-label{width:58rpx;flex-shrink:0;padding-top:12rpx;font-size:22rpx;color:#596b61}.room-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10rpx;flex:1;min-width:0}.room-tile{box-sizing:border-box;min-width:0;min-height:64rpx;display:flex;align-items:center;justify-content:center;padding:6rpx;border:1rpx solid #e8d5a9;border-radius:8rpx;background:#fff6e4;color:#70541b;font-size:22rpx;overflow-wrap:anywhere}.room-tile.occupied{border-color:#176b50;background:#e7f2eb;color:#176b50;font-weight:650}.room-tile.active{outline:4rpx solid #bd7558}.map-legend{display:block;margin-top:18rpx}.map-empty{padding:14rpx 0}
</style>
