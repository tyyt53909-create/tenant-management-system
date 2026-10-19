<template>
  <div class="tags-view">
    <el-form :inline="true" :model="createForm" class="tags-toolbar" @submit.prevent>
      <el-form-item label="新标签">
        <el-input
          v-model="createForm.name"
          placeholder="例如：学生、上班族、有宠物"
          maxlength="20"
          show-word-limit
          style="width: 220px"
          @keyup.enter="handleCreate"
        />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="createForm.sort" :min="0" :step="10" controls-position="right" style="width: 110px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="creating" @click="handleCreate">添加标签</el-button>
        <el-button @click="fetchData">刷新</el-button>
      </el-form-item>
    </el-form>

    <p class="tags-note">
      标签用于给租客分类与筛选。删除标签会同时从所有租客身上移除，但不会删除租客本身。
    </p>

    <el-table :data="tags" v-loading="loading" stripe border style="width: 100%" empty-text="还没有标签，先在上方添加一个">
      <el-table-column prop="name" label="标签名称" min-width="200" />
      <el-table-column prop="sort" label="排序" width="100" align="center" />
      <el-table-column label="使用人数" width="120" align="center">
        <template #default="{ row }">{{ row.tenantCount ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link @click="openEdit(row as Tag)">改名</el-button>
          <el-button type="danger" link @click="handleDelete(row as Tag)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="editVisible" title="修改标签" width="420px">
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editForm.name" maxlength="20" show-word-limit @keyup.enter="handleUpdate" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="editForm.sort" :min="0" :step="10" controls-position="right" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleUpdate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getTags, createTag, updateTag, deleteTag, type Tag } from '@/api/tags';

const loading = ref(false);
const creating = ref(false);
const saving = ref(false);
const tags = ref<Tag[]>([]);

const createForm = reactive<{ name: string; sort: number | undefined }>({ name: '', sort: undefined });
const editVisible = ref(false);
const editForm = reactive<{ id: string; name: string; sort: number }>({ id: '', name: '', sort: 0 });

const formatDate = (date: string) => (date ? new Date(date).toLocaleString('zh-CN') : '—');

const fetchData = async () => {
  loading.value = true;
  try {
    tags.value = await getTags();
  } catch {
    ElMessage.error('标签未能加载，请重试');
  } finally {
    loading.value = false;
  }
};

const handleCreate = async () => {
  const name = createForm.name.trim();
  if (!name) {
    ElMessage.warning('请先输入标签名称');
    return;
  }
  creating.value = true;
  try {
    await createTag({ name, sort: createForm.sort });
    ElMessage.success('标签已添加');
    createForm.name = '';
    createForm.sort = undefined;
    await fetchData();
  } catch {
    ElMessage.error('添加失败：标签名称可能已存在');
  } finally {
    creating.value = false;
  }
};

const openEdit = (row: Tag) => {
  editForm.id = row.id;
  editForm.name = row.name;
  editForm.sort = row.sort;
  editVisible.value = true;
};

const handleUpdate = async () => {
  const name = editForm.name.trim();
  if (!name) {
    ElMessage.warning('名称不能为空');
    return;
  }
  saving.value = true;
  try {
    await updateTag(editForm.id, { name, sort: editForm.sort });
    ElMessage.success('已保存');
    editVisible.value = false;
    await fetchData();
  } catch {
    ElMessage.error('保存失败：标签名称可能已存在');
  } finally {
    saving.value = false;
  }
};

const handleDelete = async (row: Tag) => {
  const count = row.tenantCount ?? 0;
  try {
    await ElMessageBox.confirm(
      count > 0
        ? `标签「${row.name}」目前用在 ${count} 位租客身上，删除后会从这些租客档案移除（租客本身不受影响）。`
        : `确定删除标签「${row.name}」吗？`,
      '删除标签',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteTag(row.id);
    ElMessage.success('标签已删除');
    await fetchData();
  } catch {
    ElMessage.error('删除失败');
  }
};

onMounted(fetchData);
</script>

<style scoped>
.tags-toolbar {
  margin-bottom: 4px;
}
.tags-note {
  margin: 0 0 12px;
  color: var(--text-muted, #8b897f);
  font-size: 12px;
}
</style>
