const {
  buildIllustratedItem,
  getSeedShopGoodsMap,
  getUserLevel,
  sortIllustratedItems,
  summarizeIllustratedItems,
} = require("./admin-illustrated-helpers");
const {
  registerAdminIllustratedPurchaseRoutes,
} = require("./admin-illustrated-purchase-routes");
const { getNongmePlantData } = require("../services/nongme-plant-data");

// 图鉴列表短时缓存：浏览器整页刷新 / 反复切页会对同一账号同一类型重复请求，
// 这里在短时间内复用结果，避免重复的 RPC 调用与日志刷屏。显式 refresh=true 会绕过并刷新缓存。
const ILLUSTRATED_CACHE_TTL_MS = 30 * 1000;
const illustratedCache = new Map();

// 图鉴类型：目前实际只有 1（作物）/ 2（变异）。不校验的话任意值都会生成一条缓存键，
// 可被用来无限撑大这张表，这里收敛到合法范围（留到 4 以兼容后续新增类型）。
const ILLUSTRATED_TYPE_MIN = 1;
const ILLUSTRATED_TYPE_MAX = 4;
// 缓存条目上限：正常用法是「账号数 × 类型数」，远超即为异常，先清过期再淘汰最旧。
const ILLUSTRATED_CACHE_MAX_ENTRIES = 200;

function normalizeIllustratedType(value) {
  const type = Math.trunc(Number(value));
  if (!Number.isFinite(type)) return ILLUSTRATED_TYPE_MIN;
  return Math.min(ILLUSTRATED_TYPE_MAX, Math.max(ILLUSTRATED_TYPE_MIN, type));
}

function illustratedCacheKey(accountId, illustratedType) {
  return `${String(accountId || "")}:${normalizeIllustratedType(illustratedType)}`;
}

/** 清掉已过期条目；仍超过上限时淘汰最旧的（Map 保持插入顺序） */
function trimIllustratedCache() {
  const now = Date.now();
  for (const [key, entry] of illustratedCache.entries()) {
    if (now - entry.at > ILLUSTRATED_CACHE_TTL_MS) illustratedCache.delete(key);
  }
  while (illustratedCache.size > ILLUSTRATED_CACHE_MAX_ENTRIES) {
    const oldestKey = illustratedCache.keys().next().value;
    if (oldestKey === undefined) break;
    illustratedCache.delete(oldestKey);
  }
}

function readIllustratedCache(accountId, illustratedType) {
  const key = illustratedCacheKey(accountId, illustratedType);
  const entry = illustratedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ILLUSTRATED_CACHE_TTL_MS) {
    illustratedCache.delete(key);
    return null;
  }
  return entry.data;
}

function writeIllustratedCache(accountId, illustratedType, data) {
  illustratedCache.set(illustratedCacheKey(accountId, illustratedType), {
    at: Date.now(),
    data,
  });
  trimIllustratedCache();
}

/** 失效缓存：不传 illustratedType 时清该账号下所有类型 */
function invalidateIllustratedCache(accountId, illustratedType) {
  // 与写入侧用同一套归一化，否则传入非法类型时删不到对应键
  const type = illustratedType === undefined || illustratedType === null || illustratedType === ""
    ? 0
    : normalizeIllustratedType(illustratedType);
  if (!type) {
    const prefix = `${String(accountId || "")}:`;
    for (const key of [...illustratedCache.keys()]) {
      if (key.startsWith(prefix)) illustratedCache.delete(key);
    }
    return;
  }
  illustratedCache.delete(illustratedCacheKey(accountId, type));
}

function getAuthorizedAccountId(req, res, { getAccountIdFromRequest, canAccessAccount }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({
      ok: false,
      error: "Missing x-account-id",
    });
    return null;
  }

  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({
      ok: false,
      error: "无权访问此账号",
    });
    return null;
  }

  return accountId;
}

function registerAdminIllustratedRoutes({
  app,
  provider,
  adminLogger,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
    invalidateIllustratedCache,
  };

  registerAdminIllustratedPurchaseRoutes({
    app,
    ...routeContext,
  });

  app.get("/api/illustrated", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      const refresh = req.query.refresh === "true";
      const illustratedType = normalizeIllustratedType(req.query.illustrated_type);

      // 非强制刷新时命中短时缓存直接返回，避开浏览器刷新风暴带来的重复请求与日志
      if (!refresh) {
        const cached = readIllustratedCache(accountId, illustratedType);
        if (cached) {
          res.json({ ok: true, data: cached, cached: true });
          return;
        }
      }

      const userLevel = getUserLevel(provider, accountId);

      adminLogger.debug("获取图鉴列表请求", {
        accountId,
        refresh,
        illustratedType,
      });

      const [seedGoodsMap, illustratedList, nongmeData] = await Promise.all([
        getSeedShopGoodsMap({
          provider,
          accountId,
          adminLogger,
          tolerateFailure: true,
        }),
        provider.getIllustratedList(accountId, refresh, illustratedType),
        getNongmePlantData(refresh),
      ]);

      adminLogger.debug("图鉴列表数据", {
        itemsCount: illustratedList?.items?.length || 0,
        hasRaw: !!illustratedList?.__raw,
        rawCount: illustratedList?.__raw?.rawItemCount || 0,
      });

      const items = sortIllustratedItems(
        (illustratedList?.items || []).map(item =>
          buildIllustratedItem(item, {
            seedGoodsMap,
            userLevel,
            nongmeFruitMap: nongmeData.byFruitId,
          }),
        ),
      );
      const summary = summarizeIllustratedItems(items);
      const data = {
        items,
        summary,
        userLevel,
        level: Number(illustratedList?.level) || 0,
        currentScore: Number(illustratedList?.current_score) || 0,
        nextScore: Number(illustratedList?.next_score) || 0,
      };

      writeIllustratedCache(accountId, illustratedType, data);

      // 被动加载（页面刷新 refresh=false）不打 info，避免刷屏；显式刷新 keep info 便于排查
      const logSummary = refresh ? adminLogger.info : adminLogger.debug;
      logSummary.call(adminLogger, "图鉴列表返回", {
        accountId,
        illustratedType,
        refresh,
        total: summary.total,
        unlocked: summary.unlocked,
        canBuy: summary.canBuy,
        userLevel,
      });

      res.json({ ok: true, data });
    } catch (err) {
      adminLogger.error("获取图鉴列表失败", {
        error: err.message,
        stack: err.stack,
      });
      sendProviderError(res, err);
    }
  });
}

module.exports = { registerAdminIllustratedRoutes };
