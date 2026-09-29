// 临时复现脚本：验证共享 2000 条窗口会把他人的日志挤占出去（跑完即删）
const { createRuntimeState } = require('./src/runtime/runtime-state');
const store = new Proxy({}, { get: () => () => ({}) });
const state = createRuntimeState({ store, operationKeys: [] });
const countOf = (id) => state.globalLogs.filter(e => e.accountId === id).length;

for (let i = 0; i < 100; i++) state.log('好友', 'A-' + i, { accountId: 'A' });
console.log('REPRO A(被查看账号) 初始条数:', countOf('A'), '| 窗口总量:', state.globalLogs.length);

let snap = countOf('A');
for (let b = 1; b <= 9; b++) {
    for (let i = 0; i < 250; i++) state.log('农场', 'B' + b + '-' + i, { accountId: 'B' + b });
    const now = countOf('A');
    if (now !== snap) {
        console.log('REPRO 其他账号累计写入 ' + (b * 250) + ' 条后 → A 只剩 ' + now);
        snap = now;
    }
}
console.log('REPRO 最终 A 剩:', countOf('A'), '| A 自己一条都没少写, 但日志被别人一点一点挤掉了');
