// 测试构建产物(dist/),而非 src——pnpm test 会先跑 pnpm build。
import { toBaseDoc, statsLineSettingsSchema, STATS_LINE_NS } from '../dist/index.js'

let failures = 0
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

// settings 命名空间 stats-line:loader config(旧 items)→ base 文档(经迁移);
// schema 给全缺省;哨兵 = 空数组/空串
check('命名空间按功能域命名', STATS_LINE_NS === 'stats-line')
const baseEmpty = toBaseDoc(undefined)
check('空 config 空序列 + style 哨兵(客户端回落内置默认)', baseEmpty.sections.length === 0 && baseEmpty.style.fontSize === '' && baseEmpty.style.sectionGap === '')
const baseLegacy = toBaseDoc({ ui: [{ kind: 'counts' }, { kind: 'sep', size: 'big' }, { kind: 'cost' }] })
check('旧 ui.items 迁移进 base 层', baseLegacy.sections.length === 2 && JSON.stringify(baseLegacy.sections[0].components) === JSON.stringify(['$turns', '$steps']) && JSON.stringify(baseLegacy.sections[1].components) === JSON.stringify(['$cost']))
const baseArr = toBaseDoc({ ui: { items: [{ kind: 'tokens' }] } })
check('ui 对象形态 items 同样迁移', baseArr.sections.length === 1 && baseArr.sections[0].sep === '')

const resolved = statsLineSettingsSchema({})
check('schema 缺省文档全哨兵', resolved.sections.length === 0 && resolved.style.fontSize === '' && resolved.style.gap === '')
const sec = statsLineSettingsSchema({ sections: [{ components: ['$turns', { show: 'TTFT $ttftLast' }] }] }).sections[0]
check('section schema 默认值补齐', sec.sep === '·' && sec.components.length === 2)
const doc = statsLineSettingsSchema({ sections: [{ sep: '', components: ['↑$input'] }], style: { fontSize: '13px' } })
check('schema 保留显式值', doc.sections[0].sep === '' && doc.style.fontSize === '13px' && doc.style.color === '')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
