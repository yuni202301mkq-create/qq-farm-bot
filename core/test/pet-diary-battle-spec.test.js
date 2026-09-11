/**
 * 萌宠日记「自动好友夺宝」需求固化测试
 *
 * 需求原文（设置页文案，与实现必须一致）：
 *   自动夺宝轮转检查好友并跳过好友黑名单，按初级、中级、高级顺序使用宝藏允许的
 *   已有挑战书，不自动购买。拾物小铺兑换仍需手动选择商品。
 *
 * 四个可验证条款：
 *   ① 轮转 —— 多轮之间必须推进游标，不得反复从同一好友开始。
 *   ② 黑名单 —— 被拉黑的好友一次都不能被查询。
 *   ③ 顺序 —— 只用「自己已有 + 宝藏允许」的挑战书，且初级 → 中级 → 高级。
 *   ④ 不自动购买 / 不自动兑换 —— 全流程只发 battle 一条命令，绝不触碰商城或拾物小铺。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPetDiaryBattleAutomation } = require('../src/services/pet-diary-battle-automation');

const BOOKS = ['80101', '80102', '80103'];

/** 挑战书库存可被真实扣减的夹具：用于验证「按顺序消耗」 */
function specFixture({ friends, books, excluded = () => false, budgetMs = 30000, withTreasure = true }) {
    let time = 1000;
    const stock = new Map(Object.entries(books));
    const balances = () => Array.from(stock, ([id, count]) => ({ id, count: String(count), known: true }));
    let pet = {
        active: true, startTime: 0, endTime: 10000000,
        hunt: { canPlunder: true }, battleCount: 0, battleLimit: 20, balances: balances(),
    };
    const actions = [];
    const scans = [];
    const run = createPetDiaryBattleAutomation({
        getPet: async () => pet,
        getFriends: async () => friends.map(gid => ({ gid: String(gid) })),
        // 每座宝藏都同时接受三种挑战书，把「顺序」这一变量单独隔离出来
        getFriend: async gid => {
            scans.push(gid);
            return {
                gid,
                treasures: withTreasure ? [{
                    id: `t${gid}`, status: 2, endTime: 9999999,
                    previews: BOOKS.map(challengeId => ({ challengeId, canStart: true })),
                }] : [],
            };
        },
        operate: async (action, params) => {
            actions.push({ action, ...params });
            stock.set(params.challengeId, Number(stock.get(params.challengeId) || 0) - 1);
            pet = { ...pet, battleCount: pet.battleCount + 1, balances: balances() };
            return { snapshot: pet };
        },
        enabled: () => true,
        excluded,
        now: () => time,
        pause: async () => { time += 400; },
        report: () => {},
        budgetMs,
    });
    return { run, actions, scans, advance: ms => { time += ms; } };
}

// ---- ① 轮转 ----

test('每轮从上一轮结束处继续，走完一圈后回到首位而不是停在同一个人', async () => {
    // budgetMs 恰好只够检查 1 人（pause 400ms 用尽预算）；宝藏置空以只观察巡检顺序
    const f = specFixture({ friends: [1, 2, 3, 4, 5], books: { 80101: 99 }, budgetMs: 400, withTreasure: false });
    for (let round = 0; round < 6; round++) {
        await f.run();
        f.advance(300000);
    }
    assert.deepEqual(f.scans, ['1', '2', '3', '4', '5', '1'],
        '应逐轮推进游标并在走完一圈后回绕到首位');
});

// ---- ② 黑名单 ----

test('黑名单好友在轮转中被跳过，且不会被发起查询', async () => {
    const blocked = new Set(['3', '5']);
    const f = specFixture({
        friends: [1, 2, 3, 4, 5], books: { 80101: 99 }, budgetMs: 400, withTreasure: false,
        excluded: gid => blocked.has(gid),
    });
    for (let round = 0; round < 9; round++) {
        await f.run();
        f.advance(300000);
    }
    assert.ok(f.scans.length > 0, '应仍在检查非黑名单好友');
    assert.ok(f.scans.every(gid => !blocked.has(gid)), `黑名单好友不应被查询，实际查询了 ${f.scans}`);
    assert.deepEqual([...new Set(f.scans)].sort(), ['1', '2', '4'], '只应查询非黑名单好友');
});

test('黑名单好友不消耗巡检预算，也不阻止本轮继续检查下一个人', async () => {
    const f = specFixture({
        friends: [1, 2, 3], books: { 80101: 3 }, excluded: gid => gid === '2',
    });
    await f.run();
    assert.deepEqual(f.actions.map(a => a.gid), ['1', '3'], '跳过拉黑好友后应继续检查后续好友');
});

// ---- ③ 挑战书顺序 ----

test('已有挑战书按初级 → 中级 → 高级顺序消耗，用尽后自动降级', async () => {
    const f = specFixture({ friends: [1, 2, 3, 4, 5, 6, 7], books: { 80101: 2, 80102: 1, 80103: 3 } });
    await f.run();
    assert.deepEqual(f.actions.map(a => a.challengeId),
        ['80101', '80101', '80102', '80103', '80103', '80103'],
        '应从初级开始用，用完再换更高一级');
});

test('没有的挑战书不会被使用，也不代表可以出手', async () => {
    const f = specFixture({ friends: [1, 2], books: { 80102: 2 } });
    await f.run();
    assert.deepEqual(f.actions.map(a => a.challengeId), ['80102', '80102'],
        '只持有中级挑战书时不得凭空使用初级或高级');
});

test('宝藏不接受的挑战书不会被强行使用', async () => {
    let time = 1000;
    let pet = {
        active: true, startTime: 0, endTime: 10000000, hunt: { canPlunder: true }, battleCount: 0,
        battleLimit: 20, balances: [{ id: '80101', count: '5', known: true }],
    };
    const actions = [];
    const run = createPetDiaryBattleAutomation({
        getPet: async () => pet,
        getFriends: async () => [{ gid: '1' }, { gid: '2' }],
        getFriend: async gid => ({
            gid,
            treasures: [{
                id: `t${gid}`, status: 2, endTime: 9999999,
                previews: [{ challengeId: '80103', canStart: true }],
            }],
        }),
        operate: async (action, params) => { actions.push({ action, ...params }); pet = { ...pet, battleCount: pet.battleCount + 1 }; return { snapshot: pet }; },
        enabled: () => true, excluded: () => false, now: () => time,
        pause: async () => { time += 400; }, report: () => {},
    });
    await run();
    assert.equal(actions.length, 0,
        '只持有初级挑战书、而宝藏只接受高级挑战书时，不得出手（也不得越级）');
});

// ---- ④ 不自动购买 / 不自动兑换 ----

test('全流程只发 battle 一条命令，参数只有目标与挑战书', async () => {
    const f = specFixture({ friends: [1, 2, 3], books: { 80101: 2, 80102: 2, 80103: 2 } });
    await f.run();
    assert.ok(f.actions.length > 0, '本场景应有出手记录');
    for (const action of f.actions) {
        assert.equal(action.action, 'battle', '除夺宝外不得发起任何操作');
        assert.deepEqual(Object.keys(action).sort(), ['action', 'challengeId', 'gid', 'treasureId'],
            '不得携带商品编号/数量等兑换或购买参数');
    }
});

test('模块内不存在购买或拾物小铺兑换的代码路径', () => {
    const source = fs.readFileSync(
        require.resolve('../src/services/pet-diary-battle-automation'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const banned of ['exchange', 'shop', 'mall', 'purchase', 'autoBuy', 'goodsId']) {
        assert.ok(!source.includes(banned), `自动夺宝不得出现 ${banned} 相关调用`);
    }
    const commands = Array.from(source.matchAll(/operate\(\s*'([^']+)'/g), m => m[1]);
    assert.deepEqual([...new Set(commands)], ['battle'], '只允许调用 battle');
});
