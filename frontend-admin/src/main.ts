import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
// 中文语言包：否则分页等组件显示英文（Total / 20 per page），见 docs/09 遗留项
import zhCn from 'element-plus/es/locale/lang/zh-cn';
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
app.use(ElementPlus, { locale: zhCn });

// 刷新页面时恢复登录态（拉取当前用户），否则头部只显示兜底文案
void useUserStore(pinia).init();

app.mount('#app');
