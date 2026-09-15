const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-settings-scope-'));
process.env.FARM_DATA_DIR = dataDir;

// 模拟单用户时代的遗留库：全局离线提醒和全局设备协议里都还留着管理员的旧配置。
// 这两块必须只搬进管理员自己的槽位，不能被普通用户继承。
const storeFile = path.join(dataDir, 'store.json');
fs.writeFileSync(storeFile, JSON.stringify({
    offlineReminder: {
        channel: 'smtp',
        smtpHost: 'legacy.example.com',
        smtpUser: 'admin@example.com',
        recipientEmail: 'admin@example.com',
        offlineDeleteSec: 600,
    },
    deviceProtocol: {
        enabled: true,
        userAgent: 'legacy-agent',
        deviceModel: 'Legacy Phone',
        deviceBrand: 'Legacy',
        deviceMac: 'AA:BB:CC:DD:EE:FF',
        deviceId: 'legacy-device-id',
        imei: 'legacy-imei',
    },
}, null, 2));

const store = require('../src/models/store');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function readStoreFile() {
    return JSON.parse(fs.readFileSync(storeFile, 'utf8'));
}

function createAccount(name, username) {
    const data = store.addOrUpdateAccount({ name, username });
    const account = data.accounts.find(item => item.name === name);
    return String(account.id);
}

const adminAccountId = createAccount('admin-acc', 'admin');
const aliceAccountId = createAccount('alice-acc', 'alice');

// ==================== 离线通知 ====================

test('遗留的全局离线提醒只搬进管理员槽位，普通用户拿默认值', () => {
    const admin = store.getOfflineReminder('admin');
    assert.equal(admin.smtpHost, 'legacy.example.com');
    assert.equal(admin.offlineDeleteSec, 600);

    // 普通用户、空用户名、未传用户名都不能回退到全局离线提醒，
    // 否则管理员的 offlineDeleteSec（到点自动删号）会落到这些账号上。
    for (const owner of ['alice', 'bob', '', undefined]) {
        const cfg = store.getOfflineReminder(owner);
        assert.equal(cfg.smtpHost, '', `owner=${String(owner)} 不该继承全局离线提醒`);
        assert.equal(cfg.offlineDeleteSec, 0, `owner=${String(owner)} 不该继承自动删号阈值`);
    }
});

test('一个用户改离线通知不会影响其他用户，也不会改写全局值', () => {
    store.setOfflineReminder({
        channel: 'webhook',
        endpoint: 'https://alice.example.com/hook',
        token: 'alice-token',
        offlineDeleteSec: 30,
    }, 'alice');

    const alice = store.getOfflineReminder('alice');
    assert.equal(alice.offlineDeleteSec, 30);
    assert.equal(alice.endpoint, 'https://alice.example.com/hook');

    assert.equal(store.getOfflineReminder('bob').offlineDeleteSec, 0);
    assert.equal(store.getOfflineReminder('admin').offlineDeleteSec, 600);

    const saved = readStoreFile();
    assert.equal(saved.userOfflineReminders.alice.offlineDeleteSec, 30);
    assert.equal(saved.offlineReminder.offlineDeleteSec, 600, '全局离线提醒不该被个人设置改写');
});

// ==================== 设备协议 ====================

test('遗留的全局设备协议只搬进管理员槽位，普通用户拿内置默认值', () => {
    const admin = store.getDeviceProtocolForAccount(adminAccountId);
    assert.equal(admin.userAgent, 'legacy-agent');
    assert.equal(admin.imei, 'legacy-imei');

    const alice = store.getDeviceProtocolForAccount(aliceAccountId);
    assert.equal(alice.userAgent, store.DEFAULT_DEVICE_PROTOCOL.userAgent);
    assert.equal(alice.deviceId, '');
    assert.equal(alice.imei, '');
    assert.equal(alice.enabled, false);
});

test('没有归属用户或账号不存在的账号不会回退到全局设备协议', () => {
    for (const accountId of ['', '   ', 'does-not-exist']) {
        const cfg = store.getDeviceProtocolForAccount(accountId);
        assert.equal(cfg.userAgent, store.DEFAULT_DEVICE_PROTOCOL.userAgent);
        assert.equal(cfg.deviceId, '');
        assert.equal(cfg.imei, '');
    }
});

test('一个用户改设备协议不会影响其他用户', () => {
    store.setUserDeviceProtocol({
        enabled: true,
        userAgent: 'alice-agent',
        deviceModel: 'Alice Phone',
        deviceBrand: 'Alice',
        deviceMac: '',
        deviceId: 'alice-device',
        imei: '',
    }, 'alice');

    const alice = store.getDeviceProtocolForAccount(aliceAccountId);
    assert.equal(alice.userAgent, 'alice-agent');
    assert.equal(alice.deviceId, 'alice-device');

    const admin = store.getDeviceProtocolForAccount(adminAccountId);
    assert.equal(admin.userAgent, 'legacy-agent', '管理员自己的设备协议不该被 alice 覆盖');
    assert.equal(admin.deviceId, 'legacy-device-id');

    const saved = readStoreFile();
    assert.equal(saved.userDeviceProtocols.alice.userAgent, 'alice-agent');
    assert.equal(saved.userDeviceProtocols.admin.userAgent, 'legacy-agent');
});

// ==================== 微信定时刷新重登（按账号隔离） ====================

test('微信定时刷新重登按账号保存，一个账号改动不影响其他账号', () => {
    store.setAutoCodeRefresh(adminAccountId, { enabled: true, intervalMinutes: 15 });
    store.setAutoCodeRefresh(aliceAccountId, { enabled: false, intervalMinutes: 60 });

    assert.deepEqual(store.getAutoCodeRefresh(adminAccountId), { enabled: true, intervalMinutes: 15 });
    assert.deepEqual(store.getAutoCodeRefresh(aliceAccountId), { enabled: false, intervalMinutes: 60 });

    // 必须落在各自的 accountConfigs[账号ID] 槽位里，不能写进任何全局配置
    const saved = readStoreFile();
    assert.equal(saved.accountConfigs[adminAccountId].autoCodeRefresh.enabled, true);
    assert.equal(saved.accountConfigs[adminAccountId].autoCodeRefresh.intervalMinutes, 15);
    assert.equal(saved.accountConfigs[aliceAccountId].autoCodeRefresh.enabled, false);
    assert.equal(saved.accountConfigs[aliceAccountId].autoCodeRefresh.intervalMinutes, 60);
    assert.equal('autoCodeRefresh' in (saved.systemConfig || {}), false);
});

// ==================== 接口权限契约 ====================

/**
 * 系统配置与抓包服务都是全站共用的服务器级设置，前端只在 isSuperAdmin 时渲染入口。
 * 后端必须用同级校验，否则普通管理员绕过界面直接调接口就能改全站配置。
 */
function assertSuperAdminOnly(source, fileLabel, routes) {
    for (const [method, routePath] of routes) {
        const escaped = routePath.replace(/\//g, '\\/');
        const pattern = new RegExp(`app\\.${method}\\(\\s*"${escaped}"\\s*,\\s*(requireAdminToken,\\s*)?([A-Za-z]+)`);
        const match = source.match(pattern);
        assert.ok(match, `${fileLabel} 未找到路由 ${method.toUpperCase()} ${routePath}`);
        assert.equal(
            match[2],
            'requireSuperAdminRole',
            `${method.toUpperCase()} ${routePath} 必须只允许超级管理员，实际是 ${match[2]}`,
        );
    }
}

test('系统配置接口只允许超级管理员调用', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/controllers/admin-system-routes.js'), 'utf8');
    assertSuperAdminOnly(source, 'admin-system-routes.js', [
        ['get', '/api/admin/system-config'],
        ['post', '/api/admin/system-config'],
        ['post', '/api/admin/system-config/reset'],
    ]);
});

test('抓包服务配置接口只允许超级管理员调用', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/controllers/admin-capture-routes.js'), 'utf8');
    assertSuperAdminOnly(source, 'admin-capture-routes.js', [
        ['get', '/api/admin/capture-config'],
        ['post', '/api/admin/capture-config'],
        ['post', '/api/admin/capture-config/test'],
    ]);
});
