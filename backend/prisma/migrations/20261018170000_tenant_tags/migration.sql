-- T215：租客标签管理（docs/00 §2.1 / §3.3 P0）
-- 由自由的 tenants.tags JSON 改为「标签字典 + 关联表」，使列表可按标签筛选、
-- 避免「学生 / 学生党 / 在校生」并存。

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_tags" (
    "tenantId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_tags_pkey" PRIMARY KEY ("tenantId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "tags_sort_idx" ON "tags"("sort");

-- CreateIndex
CREATE INDEX "tenant_tags_tagId_idx" ON "tenant_tags"("tagId");

-- AddForeignKey
ALTER TABLE "tenant_tags" ADD CONSTRAINT "tenant_tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_tags" ADD CONSTRAINT "tenant_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 数据迁移：把既有 tenants.tags（字符串数组）转为字典与关联记录。
-- 非字符串数组的旧值（对象、混合数组）无法映射到标签，直接忽略——该字段此前从未
-- 在界面上暴露，实际不会包含业务数据。同名标签复用同一行，id 由名称哈希得到，
-- 保证可重复执行且不需要应用层 cuid。
INSERT INTO "tags" ("id", "name", "sort", "createdAt", "updatedAt")
SELECT DISTINCT
       'tag_' || md5(value),
       value,
       0,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "tenants" tn
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN tn."tags" IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(tn."tags"::jsonb) = 'array' THEN tn."tags"::jsonb
    ELSE '[]'::jsonb
  END
) AS value
WHERE tn."tags" IS NOT NULL
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "tenant_tags" ("tenantId", "tagId")
SELECT DISTINCT tn."id", 'tag_' || md5(value)
FROM "tenants" tn
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN tn."tags" IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(tn."tags"::jsonb) = 'array' THEN tn."tags"::jsonb
    ELSE '[]'::jsonb
  END
) AS value
JOIN "tags" tag ON tag."name" = value
WHERE tn."tags" IS NOT NULL
ON CONFLICT DO NOTHING;

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "tags";
