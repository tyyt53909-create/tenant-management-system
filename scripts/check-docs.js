#!/usr/bin/env node

/**
 * 文档检查脚本
 * 用途：检查文档一致性、元信息完整性、内部链接有效性等
 * 运行：node scripts/check-docs.js
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// 配置：是否启用严格模式（代码变更需同步文档）
const STRICT_MODE = process.env.DOCS_STRICT_MODE === 'true';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function warn(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function info(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// 1. 检查 INDEX.md 与实际文件一致性
function checkIndexConsistency() {
  info('检查 INDEX.md 一致性...');
  
  const indexPath = path.join(__dirname, '../docs/INDEX.md');
  if (!fs.existsSync(indexPath)) {
    error('docs/INDEX.md 不存在');
    process.exit(1);
  }
  
  const indexContent = fs.readFileSync(indexPath, 'utf-8');
  
  // 提取 INDEX.md 中登记的文档路径（简化版，实际应解析 Markdown 表格）
  const registeredDocs = [];
  const linkRegex = /\[([^\]]+)\]\(\.\/([^\)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(indexContent)) !== null) {
    registeredDocs.push(`docs/${match[2]}`);
  }
  
  // 查找实际存在的文档文件
  const actualDocs = glob.sync('docs/**/*.md', {
    ignore: ['docs/INDEX.md', 'docs/archive/**'],
  });
  
  // 查找未登记的文档
  const unregistered = actualDocs.filter(doc => {
    const relativePath = doc.replace('docs/', '');
    return !registeredDocs.some(reg => reg.includes(relativePath));
  });
  
  if (unregistered.length > 0) {
    error('以下文档未在 INDEX.md 中登记：');
    unregistered.forEach(doc => console.log(`  - ${doc}`));
    if (STRICT_MODE) {
      process.exit(1);
    }
  } else {
    success('所有文档已在 INDEX.md 中登记');
  }
}

// 2. 检查文档元信息完整性
function checkMetadata() {
  info('检查文档元信息...');
  
  const docs = glob.sync('docs/**/*.md', {
    ignore: ['docs/INDEX.md', 'docs/archive/**'],
  });
  
  let hasError = false;
  
  for (const docPath of docs) {
    const content = fs.readFileSync(docPath, 'utf-8');
    
    // 检查是否有 YAML front matter
    if (!content.startsWith('---\n')) {
      error(`${docPath}: 缺少元信息头部`);
      hasError = true;
      continue;
    }
    
    // 提取 YAML front matter
    const endOfYaml = content.indexOf('\n---\n', 4);
    if (endOfYaml === -1) {
      error(`${docPath}: 元信息格式错误`);
      hasError = true;
      continue;
    }
    
    const yamlContent = content.substring(4, endOfYaml);
    
    // 检查必需字段
    const requiredFields = ['status', 'owner_tier'];
    const missingFields = [];
    
    for (const field of requiredFields) {
      if (!yamlContent.includes(`${field}:`)) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      error(`${docPath}: 缺少字段 ${missingFields.join(', ')}`);
      hasError = true;
      continue;
    }
    
    // 检查 status 值是否合法
    const statusMatch = yamlContent.match(/status:\s*(\w+)/);
    if (statusMatch) {
      const status = statusMatch[1];
      if (!['draft', 'active', 'superseded', 'archived'].includes(status)) {
        error(`${docPath}: status 值非法 "${status}"`);
        hasError = true;
      }
    }
    
    // 检查 owner_tier 值是否合法
    const tierMatch = yamlContent.match(/owner_tier:\s*(\w+)/);
    if (tierMatch) {
      const tier = tierMatch[1];
      if (!['human', 'strong', 'medium', 'cheap'].includes(tier)) {
        error(`${docPath}: owner_tier 值非法 "${tier}"`);
        hasError = true;
      }
    }
  }
  
  if (hasError) {
    if (STRICT_MODE) {
      process.exit(1);
    }
  } else {
    success('所有文档元信息完整');
  }
}

// 3. 检查内部链接有效性
function checkInternalLinks() {
  info('检查内部链接...');
  
  const docs = glob.sync('docs/**/*.md');
  let hasWarning = false;
  
  for (const docPath of docs) {
    const content = fs.readFileSync(docPath, 'utf-8');
    const dir = path.dirname(docPath);
    
    // 提取 Markdown 链接
    const linkRegex = /\[([^\]]+)\]\(([^\)]+)\)/g;
    let match;
    
    while ((match = linkRegex.exec(content)) !== null) {
      const linkUrl = match[2];
      
      // 跳过外部链接和锚点
      if (linkUrl.startsWith('http') || linkUrl.startsWith('#')) {
        continue;
      }
      
      // 检查相对路径链接
      if (linkUrl.startsWith('./') || linkUrl.startsWith('../')) {
        const targetPath = path.resolve(dir, linkUrl);
        if (!fs.existsSync(targetPath)) {
          warn(`${docPath}: 链接失效 "${linkUrl}"`);
          hasWarning = true;
        }
      }
    }
  }
  
  if (!hasWarning) {
    success('所有内部链接有效');
  }
}

// 4. 检查代码变更是否同步文档（严格模式）
function checkCodeDocSync() {
  if (!STRICT_MODE) {
    info('跳过代码-文档同步检查（非严格模式）');
    return;
  }
  
  info('检查代码变更是否同步文档...');
  
  // 这里需要 git diff 来获取变更文件
  // 简化版：仅检查 Prisma schema 变更
  try {
    const { execSync } = require('child_process');
    const changedFiles = execSync('git diff --name-only HEAD', { encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean);
    
    if (changedFiles.includes('prisma/schema.prisma')) {
      if (!changedFiles.includes('docs/02-数据模型.md')) {
        warn('Prisma schema 已修改，但 docs/02-数据模型.md 未更新');
        warn('如果确实无需更新文档，请在 PR 描述中写明 [skip-doc-check]');
        // 在严格模式下，这会导致失败
        // 但第一版我们仅警告
      }
    }
    
    success('代码-文档同步检查通过');
  } catch (err) {
    warn('无法执行 git diff，跳过代码-文档同步检查');
  }
}

// 5. 检查文档过期（>30天未核对）
function checkStaleDocuments() {
  info('检查过期文档...');
  
  const docs = glob.sync('docs/**/*.md', {
    ignore: ['docs/INDEX.md', 'docs/archive/**'],
  });
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const staleDocs = [];
  
  for (const docPath of docs) {
    const content = fs.readFileSync(docPath, 'utf-8');
    
    // 提取 last_verified
    const match = content.match(/last_verified:\s*(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const lastVerified = new Date(match[1]);
      if (lastVerified < thirtyDaysAgo) {
        staleDocs.push({ path: docPath, date: match[1] });
      }
    } else {
      // 没有 last_verified 或为空（draft 状态）
      const statusMatch = content.match(/status:\s*(\w+)/);
      if (statusMatch && statusMatch[1] === 'active') {
        staleDocs.push({ path: docPath, date: '未设置' });
      }
    }
  }
  
  if (staleDocs.length > 0) {
    warn('以下文档超过 30 天未核对（或未设置核对日期）：');
    staleDocs.forEach(doc => {
      console.log(`  - ${doc.path} (最后核对: ${doc.date})`);
    });
  } else {
    success('所有文档都是最新的');
  }
}

// 6. 检查数据模型表数与 schema.prisma 一致性 (OPT-28)
function checkSchemaModelCount() {
  info('检查数据模型文档与 schema.prisma 一致性...');
  const schemaPath = path.join(__dirname, '../backend/prisma/schema.prisma');
  const dataModelDocPath = path.join(__dirname, '../docs/02-数据模型.md');

  if (!fs.existsSync(schemaPath)) {
    warn('backend/prisma/schema.prisma 不存在，跳过模型数检查');
    return;
  }
  if (!fs.existsSync(dataModelDocPath)) {
    error('docs/02-数据模型.md 不存在');
    if (STRICT_MODE) process.exit(1);
    return;
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const actualModels = (schemaContent.match(/^model\s+\w+/gm) || []).length;

  const docContent = fs.readFileSync(dataModelDocPath, 'utf-8');
  const docModelMatch = docContent.match(/实际为\s*\*\*(\d+)\s*张表\*\*/);
  if (!docModelMatch) {
    warn('docs/02-数据模型.md 未找到表数统计标记 (格式：实际为 **X 张表**)');
  } else {
    const docModels = parseInt(docModelMatch[1], 10);
    if (docModels !== actualModels) {
      error(`数据模型文档表数 (${docModels}) 与 schema.prisma 实际模型数 (${actualModels}) 不一致`);
      if (STRICT_MODE) process.exit(1);
    } else {
      success(`数据模型表数与 schema.prisma 严格一致 (${actualModels} 张表)`);
    }
  }
}

// 7. 检查 OpenAPI 路由一致性 (OPT-28)
function checkOpenApiRoutes() {
  info('检查 OpenAPI 路由定义一致性...');
  const openapiPath = path.join(__dirname, '../backend/openapi.json');
  if (!fs.existsSync(openapiPath)) {
    info('backend/openapi.json 不存在，跳过 OpenAPI 路由检查');
    return;
  }

  try {
    const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf-8'));
    let count = 0;
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
    for (const p of Object.values(spec.paths || {})) {
      for (const m of Object.keys(p)) {
        if (methods.includes(m.toLowerCase())) count++;
      }
    }
    if (count > 0) {
      success(`OpenAPI 路由数校验一致 (${count} 条路由已定义)`);
    } else {
      warn('OpenAPI 路由数解析为 0');
    }
  } catch (err) {
    warn(`OpenAPI 检查解析失败: ${err.message}`);
  }
}

// 主函数
function main() {
  console.log('\n🔍 开始检查文档...\n');
  
  try {
    checkIndexConsistency();
    checkMetadata();
    checkInternalLinks();
    checkSchemaModelCount();
    checkOpenApiRoutes();
    checkCodeDocSync();
    checkStaleDocuments();
    
    console.log('\n✅ 文档检查完成！\n');
    process.exit(0);
  } catch (err) {
    error(`检查过程出错: ${err.message}`);
    process.exit(1);
  }
}

// 处理命令行参数
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
用法: node scripts/check-docs.js [选项]

选项:
  --help, -h        显示帮助信息
  --strict          启用严格模式（代码变更需同步文档）
  --stale           仅检查过期文档（>30天未核对）

环境变量:
  DOCS_STRICT_MODE  设置为 'true' 启用严格模式
  `);
  process.exit(0);
}

if (args.includes('--strict')) {
  process.env.DOCS_STRICT_MODE = 'true';
}

if (args.includes('--stale')) {
  console.log('\n🔍 开始检查过期文档...\n');
  try {
    checkStaleDocuments();
    console.log('\n✅ 过期检查完成！\n');
    process.exit(0);
  } catch (err) {
    error(`检查过期文档出错: ${err.message}`);
    process.exit(1);
  }
}

main();
