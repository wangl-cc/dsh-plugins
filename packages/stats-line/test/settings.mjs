// 测试构建产物(dist/),而非 src——pnpm test 会先跑 pnpm build。
import { parseUiConfig, toBaseDoc, statsLineSettingsSchema, STATS_LINE_NS } from '../dist/index.js'

let failures = 0
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

// settings 命名空间 stats-line:loader config → base 文档;非法整体回退;
// schema 给全缺省
check('命名空间按功能域命名', STATS_LINE_NS === 'stats-line')
check('ui 数组简写归一为 items', parseUiConfig([{ kind: 'cost' }, { kind: 'sep', size: 'big' }]).items.length === 2)
check('非法 item 逐个丢弃', parseUiConfig({ items: [{ kind: 'bogus' }, { kind: 'cost' }] }).items.length === 1)
check('非法 UI 配置整体回退', Object.keys(parseUiConfig({ items: 'bogus', css: 3 })).length === 0)
check('空 UI 配置合法', Object.keys(parseUiConfig(undefined)).length === 0)
const baseUi = toBaseDoc({ ui: [{ kind: 'tokens' }] })
check('loader ui items 进 base 层', baseUi.items.length === 1 && baseUi.items[0].kind === 'tokens')
const baseEmpty = toBaseDoc(undefined)
check('空 config 空序列 + 哨兵(客户端回落内置默认)', baseEmpty.items.length === 0 && baseEmpty.css === '')
const resolved = statsLineSettingsSchema({})
check('schema 缺省文档全哨兵', resolved.items.length === 0 && resolved.css === '')
const item = statsLineSettingsSchema({ items: [{ kind: 'cost' }] }).items[0]
check('item schema 默认值补齐', item.kind === 'cost' && item.size === 'small' && item.template === '')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
