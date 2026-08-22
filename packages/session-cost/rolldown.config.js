// dsh-session-cost 构建配置(rolldown)。
//
// 三个产物:
//  - dist/index.js    宿主端 ESM(zod 等外置,运行时从插件 node_modules 解析);
//  - dist/currency.js 币种解析 ESM(供 Node 测试 import);
//  - dist/client.js   浏览器端 CJS,包进 __ModuleLoader__ 工厂格式——
//    dsh-client-modules 以 classic script 加载,只认 window.__ModuleLoader__.load
//    注册的工厂;react 外置(运行时由模块表供给)。
import { defineConfig } from 'rolldown'

const clientBanner = [
  'window.__ModuleLoader__.load({',
  "  id: 'dsh-session-cost',",
  '  factory: (require) => {',
  '    var module = { exports: {} }',
  '    var exports = module.exports',
  '',
].join('\n')

const clientFooter = ['    return module.exports', '  },', '})', ''].join('\n')

export default defineConfig([
  {
    input: 'src/index.ts',
    external: ['zod', '@deepseek-ai/dsh-settings', '@deepseek-ai/schemastery'],
    output: { file: 'dist/index.js', format: 'esm' },
  },
  {
    input: 'src/currency.ts',
    output: { file: 'dist/currency.js', format: 'esm' },
  },
  {
    input: 'src/client.ts',
    external: ['react'],
    output: {
      file: 'dist/client.js',
      format: 'cjs',
      banner: clientBanner,
      footer: clientFooter,
    },
  },
])
