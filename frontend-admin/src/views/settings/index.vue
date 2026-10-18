<template>
  <div class="settings-page">
    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="邀请码管理" name="invite-codes">
        <InviteCodes />
      </el-tab-pane>

      <el-tab-pane label="资料导入" name="imports">
        <DataImport />
      </el-tab-pane>

      <el-tab-pane label="偏好与关于" name="preferences">
        <div class="v3-preferences-grid">
          <section class="v3-preferences-card">
            <h2>界面偏好</h2>
            <p>只在当前浏览器生效，不改变业务资料或权限。</p>
            <div class="v3-preference-row">
              <div>
                <strong>减少界面动画</strong>
                <p>减少转场与微动效；始终尊重系统的减少动态效果设置。</p>
              </div>
              <el-switch v-model="preferences.reduceMotion" aria-label="减少界面动画" />
            </div>
            <div class="v3-preference-row">
              <div>
                <strong>紧凑表格密度</strong>
                <p>缩小行距，便于在同一屏核对更多记录。</p>
              </div>
              <el-switch v-model="preferences.compact" aria-label="紧凑表格密度" />
            </div>
            <div class="v3-preference-row">
              <div>
                <strong>恢复默认界面偏好</strong>
                <p>只恢复布局与动效设置，不清除合同、账单或附件。</p>
              </div>
              <el-button @click="preferences.reset">恢复默认</el-button>
            </div>
            <p v-if="preferences.saveError" class="management-summary-error" role="alert">
              {{ preferences.saveError }}
            </p>
          </section>

          <section class="v3-preferences-card">
            <h2>关于管理后台</h2>
            <p>基于最新全模块原型实现，连接现有真实业务接口。</p>
            <div class="v3-about-note">
              <strong>栖居 · 管理后台 V3</strong><br />
              统一摘要、筛选和业务详情，保留资料关联与操作反馈。
            </div>
            <dl class="v3-about-list">
              <div><dt>设计参考</dt><dd>全模块优化版 V3</dd></div>
              <div><dt>资料来源</dt><dd>实际业务接口，不使用演示数据</dd></div>
              <div><dt>界面适配</dt><dd>桌面 / 平板 / 手机浏览器</dd></div>
              <div><dt>详情版型</dt><dd>遮罩抽屉，含照片与合同附件</dd></div>
              <div><dt>导出范围</dt><dd>当前已载入记录，CSV 格式</dd></div>
            </dl>
            <p class="pane-note">
              原型中的「重置演示数据」不适用于真实系统，因此不提供该操作。此页面也不代替账户权限、安全和部署配置。
            </p>
          </section>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { usePreferencesStore } from '@/stores/preferences';
import InviteCodes from './InviteCodes.vue';
import DataImport from './DataImport.vue';

const activeTab = ref('invite-codes');
const preferences = usePreferencesStore();
</script>

<style scoped>
.settings-page {
  padding: 8px 0;
}

.settings-tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}
</style>
