const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-ui-theme-'));
process.env.FARM_DATA_DIR = dataDir;

// 先落一份带脏数据的 store.json：加载时就该把用户主题归一好
const storeFile = path.join(dataDir, 'store.json');
fs.writeFileSync(storeFile, JSON.stringify({
    ui: { theme: 'dark' },
    userUIThemes: {
        alice: 'dark-blue',
        bob: 'DARK-PURPLE',
        '  ': 'light',
        carol: 'bad theme!!',
        dave: '',
    },
}, null, 2));

const store = require('../src/models/store');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function readStoreFile() {
    return JSON.parse(fs.readFileSync(storeFile, 'utf8'));
}

test('加载时归一用户主题：合法值保留并小写化，非法值丢弃', () => {
    assert.equal(store.getUI('alice').theme, 'dark-blue');
    // 大写会被归一成小写
    assert.equal(store.getUI('bob').theme, 'dark-purple');
    // 非法标识与空值直接丢弃，回退到全局默认值
    assert.equal(store.getUI('carol').theme, 'dark');
    assert.equal(store.getUI('dave').theme, 'dark');
    // 空用户名不写入
    assert.equal(store.getUI('  ').theme, 'dark');
});

test('一个用户改主题不会影响其他用户，也不会改全局默认值', () => {
    store.setUITheme('light-green', 'alice');

    assert.equal(store.getUI('alice').theme, 'light-green');
    // erin 从没设置过，仍然拿到全局默认值
    assert.equal(store.getUI('erin').theme, 'dark');
    // 不带用户名的内部读取同样只看到全局默认值
    assert.equal(store.getUI().theme, 'dark');
    // 落盘的全局默认值必须没被动过
    assert.equal(readStoreFile().ui.theme, 'dark');
});

test('保存时会把加载阶段残留的脏键清掉', () => {
    // 上一条测试已经触发过一次保存，脏键不该再出现在 store.json 里
    const saved = readStoreFile();
    assert.equal(saved.userUIThemes.carol, undefined);
    assert.equal(saved.userUIThemes.dave, undefined);
    assert.equal(saved.userUIThemes['  '], undefined);
    assert.deepEqual(Object.keys(saved.userUIThemes).sort(), ['alice', 'bob']);
});

test('用户主题会落盘到自己的槽位', () => {
    store.setUITheme('dark-red', 'bob');

    const saved = readStoreFile();
    assert.equal(saved.userUIThemes.alice, 'light-green');
    assert.equal(saved.userUIThemes.bob, 'dark-red');
    assert.equal(saved.ui.theme, 'dark');
});

test('非法主题被忽略，不会覆盖已有值，也不会新建槽位', () => {
    store.setUITheme('light-pink', 'alice');
    store.setUITheme('bad theme!!', 'alice');
    assert.equal(store.getUI('alice').theme, 'light-pink');

    store.setUITheme('', 'alice');
    assert.equal(store.getUI('alice').theme, 'light-pink');

    store.setUITheme('dark-blue', '');
    assert.equal(store.getUI().theme, 'dark');
    assert.equal(store.getUI('alice').theme, 'light-pink');
});

test('用户名两侧空白会被裁掉，同一个用户不会分裂成两条记录', () => {
    store.setUITheme('dark-teal', '  alice  ');

    assert.equal(store.getUI('alice').theme, 'dark-teal');
    const saved = readStoreFile();
    assert.equal(saved.userUIThemes.alice, 'dark-teal');
    assert.equal(Object.keys(saved.userUIThemes).filter(k => k.trim() === 'alice').length, 1);
});

test('没有用户上下文的内部调用才允许改全局默认值', () => {
    store.setUITheme('light');

    // 全局默认值变了
    assert.equal(store.getUI().theme, 'light');
    assert.equal(store.getUI('erin').theme, 'light');
    // 但设置过主题的用户仍然用自己的，不被全局值影响
    assert.equal(store.getUI('alice').theme, 'dark-teal');
    assert.equal(store.getUI('bob').theme, 'dark-red');
});
