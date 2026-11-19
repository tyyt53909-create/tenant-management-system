<template>
  <view class="life-calendar">
    <view class="calendar-header">
      <text class="calendar-title">生活月历</text>
      <view class="month-nav">
        <button role="button" tabindex="0"class="calendar-button calendar-arrow" aria-label="上个月" @tap="move(-1)">‹</button>
        <text class="month-label">{{ year }}年{{ month + 1 }}月</text>
        <button role="button" tabindex="0"class="calendar-button calendar-arrow" aria-label="下个月" @tap="move(1)">›</button>
      </view>
    </view>

    <view class="calendar-grid">
      <text v-for="label in weekdays" :key="label" class="weekday">{{ label }}</text>
      <template v-for="(day, index) in days" :key="index">
        <button role="button" tabindex="0"v-if="day" :class="['calendar-button', 'calendar-day', { selected: selected === day, today: today === key(day) }]"
          :aria-label="dayLabel(day)" :aria-pressed="selected === day" @tap="select(day)">
          <text>{{ day }}</text>
          <view v-if="eventsByDate.has(key(day))" class="event-dot" />
        </button>
        <view v-else aria-hidden="true" />
      </template>
    </view>

    <view class="agenda-heading">
      <view class="agenda-date">
        <text>{{ month + 1 }}月{{ selected }}日</text>
        <text v-if="selectedDate === today" class="agenda-meta">今天</text>
        <text v-if="selectedEvents.length" class="agenda-meta">{{ selectedEvents.length }} 项</text>
      </view>
      <button role="button" tabindex="0"v-if="selectedDate !== today" class="calendar-button agenda-action" @tap="goToToday">回到今天</button>
    </view>

    <view v-if="selectedEvents.length" class="agenda-items">
      <button role="button" tabindex="0"v-for="event in visibleEvents" :key="event.id" class="calendar-button calendar-event" @tap="$emit('open', event)">
        <view class="event-icon"><QIcon :name="event.type === 'repair' ? 'repair' : 'wallet'" :size="34" /></view>
        <view class="event-copy">
          <text class="event-title">{{ event.title }}</text>
          <text class="event-description">{{ event.description }}</text>
        </view>
        <text class="event-arrow" aria-hidden="true">›</text>
      </button>
      <button role="button" tabindex="0"v-if="extraCount" class="calendar-button agenda-action agenda-toggle" :aria-expanded="expanded" @tap="expanded = !expanded">
        {{ expanded ? '收起其余事项' : `展开其余 ${extraCount} 项` }}
      </button>
    </view>
    <view v-else class="agenda-empty">
      <text>{{ loading ? '正在加载日程…' : hasError ? '部分日程暂未更新' : '当天暂无安排' }}</text>
    </view>
  </view>
</template>

<script>
import QIcon from './QIcon.vue'
import { monthDays, dateKey } from '../utils/calendar.js'

const PREVIEW_LIMIT = 2

export default {
  components: { QIcon },
  props: { events: { type: Array, default: () => [] }, loading: Boolean, hasError: Boolean },
  emits: ['open'],
  data() {
    const now = new Date()
    const year = now.getFullYear(), month = now.getMonth(), selected = now.getDate()
    return { year, month, selected, today: dateKey(year, month, selected), expanded: false, weekdays: ['一', '二', '三', '四', '五', '六', '日'] }
  },
  computed: {
    days() { return monthDays(this.year, this.month) },
    eventsByDate() {
      const byDate = new Map()
      for (const event of this.events) {
        if (!byDate.has(event.date)) byDate.set(event.date, [])
        byDate.get(event.date).push(event)
      }
      return byDate
    },
    selectedDate() { return this.key(this.selected) },
    selectedEvents() { return this.eventsByDate.get(this.selectedDate) || [] },
    extraCount() { return Math.max(0, this.selectedEvents.length - PREVIEW_LIMIT) },
    visibleEvents() { return this.expanded ? this.selectedEvents : this.selectedEvents.slice(0, PREVIEW_LIMIT) }
  },
  mounted() {
    // #ifdef H5
    this.$el.addEventListener('keydown', this.handleCalendarKey)
    // #endif
  },
  beforeUnmount() {
    // #ifdef H5
    this.$el.removeEventListener('keydown', this.handleCalendarKey)
    // #endif
  },
  methods: {
    handleCalendarKey(event) {
      const button = event.target
      // uni-app H5 渲染为自定义元素，需补上原生 button 的键盘行为。
      if (button?.tagName !== 'UNI-BUTTON' || !button.classList.contains('calendar-button')) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (!event.repeat) button.click()
    },
    key(day) { return dateKey(this.year, this.month, day) },
    dayLabel(day) {
      const date = this.key(day)
      const count = this.eventsByDate.get(date)?.length || 0
      return `${this.month + 1}月${day}日${date === this.today ? '，今天' : ''}${count ? `，${count} 项安排` : ''}`
    },
    select(day) {
      if (day === this.selected) return
      this.selected = day
      this.expanded = false
    },
    move(delta) { this.showDate(new Date(this.year, this.month + delta, 1)) },
    goToToday() {
      const now = new Date()
      this.showDate(now)
      this.today = this.selectedDate
    },
    showDate(date) {
      this.year = date.getFullYear()
      this.month = date.getMonth()
      this.selected = date.getDate()
      this.expanded = false
    }
  }
}
</script>

<style scoped>
.life-calendar { background: #fffefa; border: 1rpx solid #e9e6de; border-radius: 36rpx; padding: 24rpx 24rpx 28rpx; box-shadow: 0 12rpx 34rpx rgba(74, 62, 47, .04); }
.calendar-header, .agenda-heading { display: flex; align-items: center; justify-content: space-between; gap: 8rpx; }
.calendar-header { margin-bottom: 16rpx; }
.calendar-title { font-size: 28rpx; font-weight: 650; }
.month-nav { display: flex; align-items: center; color: #68665e; }
.month-label { font-size: 24rpx; white-space: nowrap; }
.calendar-button { display: flex; align-items: center; justify-content: center; margin: 0; padding: 0; min-height: 44px; line-height: 1.35; border: 0; background: transparent; color: #4e5845; }
.calendar-button::after { border: 0; }
.calendar-button:focus-visible { outline: 2px solid #68715b; outline-offset: 2px; }
.calendar-arrow { min-width: 44px; font-size: 36rpx; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4rpx; }
.weekday { text-align: center; font-size: 22rpx; color: #68665e; padding-bottom: 10rpx; }
.calendar-day { position: relative; width: 100%; border-radius: 18rpx; font-size: 24rpx; color: #68665e; }
.calendar-day.today { font-weight: 700; color: #4e5845; }
.calendar-day.selected { background: #68715b; color: #fffefa; }
.calendar-button:not(.selected):active { background: #ebe8df; }
.event-dot { position: absolute; bottom: 6px; width: 4px; height: 4px; background: #ad735a; border-radius: 50%; }
.selected .event-dot { background: #e5d3b5; }
.agenda-heading { min-height: 44px; margin: 16rpx 0 8rpx; padding-left: 8rpx; border-top: 1rpx solid #e9e6de; }
.agenda-date { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8rpx; font-size: 26rpx; font-weight: 650; }
.agenda-meta { font-size: 22rpx; font-weight: 400; color: #68665e; }
.agenda-action { padding: 0 12rpx; font-size: 23rpx; font-weight: 550; white-space: nowrap; border-radius: 12rpx; }
.agenda-toggle { width: 100%; }
.agenda-items { display: grid; gap: 8rpx; }
.calendar-event { width: 100%; gap: 14rpx; justify-content: flex-start; padding: 12rpx 16rpx; border-radius: 18rpx; background: #f4f2ec; text-align: left; color: #302f2a; }
.event-icon { width: 48rpx; height: 48rpx; background: #ebe8df; border-radius: 14rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.event-copy { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.event-title { display: block; font-size: 24rpx; font-weight: 550; }
.event-description { display: block; margin-top: 4rpx; font-size: 21rpx; color: #68665e; }
.event-arrow { flex-shrink: 0; font-size: 30rpx; color: #817e76; }
.agenda-empty { border-radius: 18rpx; background: #f4f2ec; padding: 20rpx 16rpx; color: #68665e; font-size: 23rpx; }
</style>
