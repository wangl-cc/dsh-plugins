// dsh-vibeguard 构建配置(rolldown)。
//
// 两个产物(纯 host 插件,无 client 半):
//  - dist/index.js  宿主端 ESM(zod 外置,运行时从插件 node_modules 解析);
//  - dist/core.js   纯逻辑 ESM(engine/patterns/store,供 Node 测试 import)。
import { defineConfig } from 'rolldown'

export default defineConfig([
  {
    input: 'src/index.ts',
    external: ['zod'],
    output: { file: 'dist/index.js', format: 'esm' },
  },
  {
    input: 'src/core.ts',
    output: { file: 'dist/core.js', format: 'esm' },
  },
])
