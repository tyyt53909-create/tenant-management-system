<template>
  <div class="public-rooms">
    <el-card shadow="never">
      <template #header>
        <div class="header">
          <div>
            <h2 class="title">在租房源</h2>
            <p class="sub">以下为当前可租的空置房源，如需看房请联系管理员。</p>
          </div>
          <el-tag type="success" effect="plain">共 {{ pagination.total }} 间可租</el-tag>
        </div>
      </template>

      <el-form :inline="true" :model="query">
        <el-form-item label="楼栋">
          <el-select v-model="query.buildingId" placeholder="全部楼栋" clearable style="width: 180px">
            <el-option v-for="b in buildings" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="房型">
          <el-select v-model="query.roomType" placeholder="全部房型" clearable style="width: 150px">
            <el-option label="单间" value="SINGLE" />
            <el-option label="一室" value="ONE_BED" />
            <el-option label="两室" value="TWO_BED" />
            <el-option label="三室" value="THREE_BED" />
            <el-option label="开间" value="STUDIO" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼层">
          <el-input-number v-model="query.floor" :min="0" placeholder="不限" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <section v-if="publicSpace" class="public-space" aria-label="可租房源分布">
        <h3>可租房源分佈</h3>
        <SpacePlan2DContract :model="rentableOnlySpace" />
      </section>

      <el-empty v-if="!loading && tableData.length === 0" description="暂无可租房源" />

      <el-row v-else :gutter="16" v-loading="loading">
        <el-col v-for="room in tableData" :key="room.id" :xs="24" :sm="12" :md="8" :lg="6">
          <el-card class="room-card" shadow="hover" @click="openDetail(room)">
            <div class="room-cover">
              <img v-if="room.photos.length" :src="room.photos[0].thumbnail || room.photos[0].fileUrl" alt="房源照片" />
              <div v-else class="no-photo">暂无照片</div>
            </div>
            <div class="room-body">
              <div class="room-title">
                <span>{{ room.building.name }} · {{ room.roomNumber }}</span>
                <el-tag size="small" type="success">可租</el-tag>
              </div>
              <div class="room-meta">
                {{ roomTypeMap[room.roomType] || room.roomType }}
                <span v-if="room.area"> · {{ room.area }} ㎡</span>
                · {{ room.floor }} 层
              </div>
              <div class="room-desc">{{ room.description || '暂无描述' }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          :page-sizes="[12, 24, 48]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchData"
          @size-change="handleQuery"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" :title="detail ? detail.building.name + ' · ' + detail.roomNumber : ''" width="640px">
      <div v-if="detail">
        <div v-if="detail.photos.length" class="detail-photos">
          <img v-for="p in detail.photos" :key="p.fileUrl" :src="p.thumbnail || p.fileUrl" alt="房源照片" />
        </div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="房型">{{ roomTypeMap[detail.roomType] || detail.roomType }}</el-descriptions-item>
          <el-descriptions-item label="楼层">{{ detail.floor }} 层</el-descriptions-item>
          <el-descriptions-item label="面积">{{ detail.area ? detail.area + ' ㎡' : '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag type="success" size="small">可租</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="楼栋地址" :span="2">
            {{ detail.building.address || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">
            {{ detail.description || '暂无描述' }}
          </el-descriptions-item>
        </el-descriptions>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          style="margin-top: 16px"
          title="本页仅展示房源基本信息，不含任何租客信息。看房请联系管理员。"
        />
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { getPublicBuildings, getPublicRooms, getPublicBuildingSpace } from '@/api/public';
import type { PublicBuilding, PublicRoom } from '@/api/public';
import type { SpaceModelContract } from '@/types/space';
import SpacePlan2DContract from '@/components/space/SpacePlan2DContract.vue';
import { notifyApiError } from '@/utils/notify';

const loading = ref(false);
const buildings = ref<PublicBuilding[]>([]);
const tableData = ref<PublicRoom[]>([]);
const detailVisible = ref(false);
const detail = ref<PublicRoom | null>(null);
const publicSpace = ref<SpaceModelContract | null>(null);
const rentableOnlySpace = computed<SpaceModelContract>(() => {
  const model = publicSpace.value!;
  const floors = model.floors.map((floor) => ({
    ...floor,
    rooms: floor.rooms.filter((room) => room.state === 'RENTABLE').map((room) => ({
      id: room.id, roomNumber: room.roomNumber, floor: room.floor, shape: room.shape,
      state: room.state, alerts: [], version: room.version, unplaced: room.unplaced,
    })),
  }));
  const total = floors.reduce((count, floor) => count + floor.rooms.length, 0);
  return {
    ...model, view: 'PUBLIC', capabilities: { canSeeTenant: false, canSeeRent: false, canOperateStatus: false, canOperateCleaning: false }, floors,
    summary: { total, occupied: 0, reserved: 0, rentable: total, pendingClean: 0, cleaning: 0, maintenance: 0, unknown: 0, occupancyRate: 0, rentableRate: total ? 100 : 0 },
  };
});

const query = reactive<{ buildingId?: string; roomType?: string; floor?: number }>({});
const pagination = reactive({ page: 1, limit: 12, total: 0 });

const roomTypeMap: Record<string, string> = {
  SINGLE: '单间',
  ONE_BED: '一室',
  TWO_BED: '两室',
  THREE_BED: '三室',
  STUDIO: '开间',
};

const fetchData = async () => {
  loading.value = true;
  try {
    const res = await getPublicRooms({
      page: pagination.page,
      limit: pagination.limit,
      buildingId: query.buildingId,
      roomType: query.roomType,
      floor: query.floor,
    });
    tableData.value = res.data;
    pagination.total = res.meta.total;
  } catch (error) {
    notifyApiError(error, '获取房源失败');
  } finally {
    loading.value = false;
  }
};

const handleQuery = () => {
  pagination.page = 1;
  loadPublicSpace(query.buildingId);
  fetchData();
};

const handleReset = () => {
  query.buildingId = undefined;
  query.roomType = undefined;
  query.floor = undefined;
  handleQuery();
};

const openDetail = (room: PublicRoom) => {
  detail.value = room;
  detailVisible.value = true;
};

const loadBuildings = async () => {
  try {
    buildings.value = await getPublicBuildings();
    if (!query.buildingId && buildings.value.length) {
      query.buildingId = buildings.value[0].id;
      await loadPublicSpace(query.buildingId);
    }
  } catch {
    // 楼栋列表失败不阻断房源列表
  }
};

const loadPublicSpace = async (buildingId?: string) => {
  publicSpace.value = null;
  if (!buildingId) return;
  try {
    publicSpace.value = await getPublicBuildingSpace(buildingId);
  } catch {
    // 平面图失败不阻断公开房源列表。
  }
};

onMounted(() => {
  loadBuildings();
  fetchData();
});
</script>

<style scoped>
.public-rooms { padding: 0; }
.public-space { margin: 4px 0 20px; min-width: 0; }
.public-space h3 { margin: 0 0 10px; font-size: 16px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; }
.title { margin: 0; font-size: 20px; }
.sub { margin: 6px 0 0; color: var(--text-muted); font-size: 13px; }
.room-card { margin-bottom: 16px; cursor: pointer; }
.room-cover { height: 140px; background: #f5f7fa; border-radius: 4px; overflow: hidden; }
.room-cover img { width: 100%; height: 100%; object-fit: cover; }
.no-photo { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 13px; }
.room-body { padding-top: 10px; }
.room-title { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
.room-meta { margin-top: 6px; color: #606266; font-size: 13px; }
.room-desc { margin-top: 6px; color: var(--text-muted); font-size: 12px; min-height: 32px; }
.detail-photos { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.detail-photos img { width: 140px; height: 100px; object-fit: cover; border-radius: 4px; }
</style>
