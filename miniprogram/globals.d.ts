/// <reference types="@dcloudio/types" />

/**
 * Vite define 注入的构建期常量（FE-02 / T287）。
 * `vite.config.js` 里 `define: { __API_BASE_URL__: ... }` 会在编译时内联替换。
 */
declare const __API_BASE_URL__: string | undefined;
