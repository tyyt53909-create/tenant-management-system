-- 设置时区
SET timezone = 'Asia/Shanghai';

-- 创建扩展（如需要）
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 初始化完成日志
DO $$
BEGIN
  RAISE NOTICE '数据库初始化完成';
END $$;
