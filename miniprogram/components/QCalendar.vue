<template>
  <view class="life-calendar">
    <view class="calendar-header"><text class="calendar-title">生活月历</text><view class="month-nav"><text>{{ year }}年{{ month + 1 }}月</text><button class="calendar-arrow" aria-label="上个月" @tap="move(-1)">‹</button><button class="calendar-arrow" aria-label="下个月" @tap="move(1)">›</button></view></view>
    <view class="calendar-grid"><text v-for="label in weekdays" :key="label" class="weekday">{{ label }}</text><view v-for="(day, index) in days" :key="index" :class="['calendar-day', { selected: day && selected === day, today: day && today === key(day), blank: !day }]" @tap="select(day)"><text v-if="day">{{ day }}</text><view v-if="day && eventDates.includes(key(day))" class="event-dot" /></view></view>
    <view v-if="selectedEvents.length" class="calendar-event" @tap="$emit('open', selectedEvents[0])"><view class="event-icon"><QIcon :name="selectedEvents[0].type === 'repair' ? 'repair' : 'wallet'" :size="34" /></view><view class="event-copy"><text class="event-title">{{ month + 1 }}月{{ selected }}日 · {{ selectedEvents[0].title }}</text><text class="event-description">{{ selectedEvents[0].description }}{{ selectedEvents.length > 1 ? ` · 共 ${selectedEvents.length} 项` : '' }}</text></view><text class="q-arrow">›</text></view>
    <view v-else class="calendar-event"><view class="event-icon"><QIcon name="calendar" :size="34" /></view><view class="event-copy"><text class="event-title">{{ month + 1 }}月{{ selected }}日</text><text class="event-description">暂无近期安排，安心生活</text></view></view>
  </view>
</template>
<script>
import QIcon from './QIcon.vue'
import { monthDays, dateKey } from '../utils/calendar.js'
export default {
  components: { QIcon }, props: { events: { type: Array, default: () => [] } }, emits: ['open'],
  data() { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth(), selected: d.getDate(), today: dateKey(d.getFullYear(), d.getMonth(), d.getDate()), weekdays: ['一', '二', '三', '四', '五', '六', '日'] } },
  computed: { days() { return monthDays(this.year, this.month) }, eventDates() { return this.events.map(e => e.date) }, selectedEvents() { return this.events.filter(e => e.date === this.key(this.selected)) } },
  methods: { key(day) { return dateKey(this.year, this.month, day) }, select(day) { if (day) this.selected = day }, move(delta) { const d = new Date(this.year, this.month + delta, 1); this.year = d.getFullYear(); this.month = d.getMonth(); this.selected = 1 } }
}
</script>
<style scoped>
.life-calendar{background:#fffefa;border:1rpx solid #e9e6de;border-radius:36rpx;padding:34rpx 32rpx 24rpx;box-shadow:0 12rpx 34rpx rgba(74,62,47,.04)}.calendar-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24rpx}.calendar-title{font-size:28rpx;font-weight:650}.month-nav{display:flex;align-items:center;gap:10rpx;font-size:22rpx;color:#817e76}.calendar-arrow{width:36rpx;height:40rpx;line-height:34rpx;padding:0;margin:0;border:0;background:transparent;font-size:32rpx;color:#817e76}.calendar-arrow:after{border:0}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8rpx}.weekday{text-align:center;font-size:20rpx;color:#aaa395;padding-bottom:12rpx}.calendar-day{height:66rpx;display:flex;align-items:center;justify-content:center;font-size:24rpx;color:#68665e;position:relative;border-radius:18rpx}.calendar-day.today{font-weight:700;color:#4e5845}.calendar-day.selected{background:#68715b;color:white}.event-dot{position:absolute;bottom:8rpx;width:5rpx;height:5rpx;background:#ad735a;border-radius:50%}.selected .event-dot{background:#e5d3b5}.calendar-event{display:flex;gap:16rpx;align-items:center;background:#f4f2ec;border-radius:22rpx;padding:22rpx 18rpx;margin-top:24rpx}.event-icon{width:54rpx;height:54rpx;background:#ebe8df;border-radius:17rpx;display:flex;align-items:center;justify-content:center;flex-shrink:0}.event-copy{flex:1;min-width:0}.event-title{display:block;font-size:22rpx;font-weight:550}.event-description{display:block;margin-top:8rpx;font-size:20rpx;color:#8b857a;line-height:1.6}.q-arrow{font-size:32rpx;color:#a49f95}
</style>
