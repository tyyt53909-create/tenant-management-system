import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { useUserStore } from './stores/user';

// 先加载基础样式，再覆盖 CSS 变量，避免默认蓝色覆盖栖居主题。
import 'element-plus/dist/index.css';
import './styles/element-variables.css';
import './style.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// 注意：Element Plus 组件不再在此全量注册（原 app.use(ElementPlus) 会把整库打进首屏 JS）。
// 组件与指令（含 v-loading）由 vite.config.ts 的 ElementPlusResolver 按需自动引入；
// 中文语言包由 App.vue 的 <el-config-provider> 提供。

// 刷新页面时恢复登录态（拉取当前用户），否则头部只显示兜底文案
void useUserStore(pinia).init();

app.mount('#app');
