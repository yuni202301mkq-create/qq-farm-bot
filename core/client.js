const process = require('node:process');

const {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
} = require('./src/controllers/admin');
const { createRuntimeEngine } = require('./src/runtime/runtime-engine');
const { createModuleLogger } = require('./src/services/logger');

const mainLogger = createModuleLogger('main');
const isWorkerProcess = process.env.FARM_WORKER === '1';

// ---- 进程级异常兜底 ----
// Node >= 15 对未处理的 Promise 拒绝会直接退出进程，而 Express 4 不会接管 async
// handler 的拒绝（超时守卫后二次 res.json 会抛 ERR_HTTP_HEADERS_SENT 等）。这里统一
// 兜底：先记录日志并继续运行，避免单个异常拖垮整个服务；仅在短时间内异常风暴式爆发
// 时才退出，防止进程陷入不可用状态并无限刷日志。
const MAX_FATAL_ERRORS = 100;
const FATAL_ERROR_WINDOW_MS = 60 * 1000;
let fatalErrorCount = 0;
let fatalWindowStart = Date.now();

function isFatalErrorStorm() {
    const now = Date.now();
    if (now - fatalWindowStart > FATAL_ERROR_WINDOW_MS) {
        fatalWindowStart = now;
        fatalErrorCount = 0;
    }
    fatalErrorCount += 1;
    return fatalErrorCount > MAX_FATAL_ERRORS;
}

process.on('unhandledRejection', (reason) => {
    const detail = reason && reason.stack ? reason.stack : String(reason);
    mainLogger.error(`未处理的 Promise 拒绝: ${detail}`);
    if (isFatalErrorStorm()) {
        mainLogger.error('未处理拒绝过于频繁，进程退出以防资源耗尽');
        process.exit(1);
    }
});

process.on('uncaughtException', (err) => {
    const detail = err && err.stack ? err.stack : String(err);
    mainLogger.error(`未捕获异常: ${detail}`);
    if (isFatalErrorStorm()) {
        mainLogger.error('未捕获异常过于频繁，进程退出以防资源耗尽');
        process.exit(1);
    }
});

async function bootstrap() {
    if (isWorkerProcess) {
        require('./src/core/worker');
        return;
    }

    // 抓包服务子命令：qq-farm-bot --capture（或 FARM_CAPTURE_SERVER=1）
    if (process.argv.includes('--capture') || process.env.FARM_CAPTURE_SERVER === '1') {
        const { startCaptureServer } = require('./src/capture/index');
        const { resolveAdvertiseAddresses } = require('./src/capture/ip-utils');
        const { config, stop, log } = await startCaptureServer();
        const advertise = resolveAdvertiseAddresses(config);
        log.info(`抓包服务已启动，API: http://${config.apiHost}:${config.apiPort}`);
        log.info(`对外代理地址: ${advertise.addresses.length
            ? advertise.addresses.map(item => `${item.address} (${item.kind})`).join(', ')
            : '未检测到可用地址'}`);
        const shutdown = (signal) => {
            log.info(`收到 ${signal}，正在关闭抓包服务...`);
            void stop().then(() => process.exit(0));
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        return;
    }

    const runtimeEngine = createRuntimeEngine({
        processRef: process,
        mainEntryPath: __filename,
        startAdminServer,
        onStatusSync: (accountId, status) => {
            emitRealtimeStatus(accountId, status);
        },
        onLog: (entry, accountId) => {
            if (accountId && entry) {
                entry.accountId = accountId;
            }
            emitRealtimeLog(entry);
        },
        onAccountLog: (entry) => {
            emitRealtimeAccountLog(entry);
        },
    });

    runtimeEngine.start({
        startAdminServer: true,
        autoStartAccounts: false,
    }).catch((err) => {
        mainLogger.error('runtime bootstrap failed', {
            error: err && err.message ? err.message : String(err),
        });
    });
}

bootstrap().catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
});
