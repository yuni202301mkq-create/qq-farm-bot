/**
 * Proto 加载与消息类型管理
 */

const protobuf = require('protobufjs');
const { getResourcePath } = require('../config/runtime-paths');
const { log } = require('./utils');

// Proto 根对象与所有消息类型
let root = null;
const types = {};
// 消息类型是否已全部挂到 types 上。不能拿 root 当就绪判据：root 在 `await root.load(...)`
// 返回后就已经非空，而 types 要到之后逐个 lookupType 才填满，中间存在窗口。
let protoReady = false;
// 等待 proto 就绪的调用方。用集合而不是单例 promise：单例只能被唤醒一次，
// 一旦某次加载失败并唤醒了等待方，之后重新加载时新注册的等待方会立刻拿到旧的失败结论。
const protoReadyWaiters = [];
// 等待上限。proto 正常只需几十毫秒，这里只是兜底：万一加载从未被触发，
// 等待方要拿到明确错误而不是永久挂起，同时从等待队列里移除避免堆积。
const PROTO_WAIT_TIMEOUT_MS = 8000;

function notifyProtoWaiters() {
    while (protoReadyWaiters.length > 0) {
        const waiter = protoReadyWaiters.shift();
        if (waiter.timer) clearTimeout(waiter.timer);
        if (protoReady) {
            waiter.resolve(true);
        } else {
            waiter.reject(new Error('Protobuf 定义加载失败，无法编解码消息'));
        }
    }
}

/**
 * 加载 proto 文件并把所有消息类型挂到 `types` 上。
 * 就绪状态只在最后一批 lookupType 完成后置为 true，对外请用下面的 `loadProto`，
 * 它会保证成功和失败都唤醒等待方。
 */
async function loadProtoInner() {
    log('系统', '正在加载 Protobuf 定义...');
    root = new protobuf.Root();
    await root.load([
        getResourcePath('proto', 'game.proto'),
        getResourcePath('proto', 'userpb.proto'),
        getResourcePath('proto', 'plantpb.proto'),
        getResourcePath('proto', 'corepb.proto'),
        getResourcePath('proto', 'shoppb.proto'),
        getResourcePath('proto', 'friendpb.proto'),
        getResourcePath('proto', 'visitpb.proto'),
        getResourcePath('proto', 'weatherpb.proto'),
        getResourcePath('proto', 'notifypb.proto'),
        getResourcePath('proto', 'taskpb.proto'),
        getResourcePath('proto', 'itempb.proto'),
        getResourcePath('proto', 'emailpb.proto'),
        getResourcePath('proto', 'mallpb.proto'),
        getResourcePath('proto', 'redpacketpb.proto'),
        getResourcePath('proto', 'qqvippb.proto'),
        getResourcePath('proto', 'sharepb.proto'),
        getResourcePath('proto', 'illustratedpb.proto'),
        getResourcePath('proto', 'interactpb.proto'),
        getResourcePath('proto', 'dogpb.proto'),
        getResourcePath('proto', 'activitypb.proto'),
        getResourcePath('proto', 'pet-diary.proto'),
        getResourcePath('proto', 'mysteryshoppb.proto'),
        getResourcePath('proto', 'acepb.proto'),
        getResourcePath('proto', 'careerpb.proto'),
        getResourcePath('proto', 'paypb.proto'),
    ], { keepCase: true });

    // 网关
    types.GateMessage = root.lookupType('gatepb.Message');
    types.GateMeta = root.lookupType('gatepb.Meta');
    types.EventMessage = root.lookupType('gatepb.EventMessage');

    // 用户
    types.LoginRequest = root.lookupType('gamepb.userpb.LoginRequest');
    types.LoginReply = root.lookupType('gamepb.userpb.LoginReply');
    types.HeartbeatRequest = root.lookupType('gamepb.userpb.HeartbeatRequest');
    types.HeartbeatReply = root.lookupType('gamepb.userpb.HeartbeatReply');
    types.ReportArkClickRequest = root.lookupType('gamepb.userpb.ReportArkClickRequest');
    types.ReportArkClickReply = root.lookupType('gamepb.userpb.ReportArkClickReply');
    types.AntiDataRequest = root.lookupType('gamepb.acepb.AntiDataRequest');
    types.AntiDataReply = root.lookupType('gamepb.acepb.AntiDataReply');
    types.CareerInfoGetRequest = root.lookupType('gamepb.careerpb.CareerInfoGetRequest');
    types.CareerInfoGetReply = root.lookupType('gamepb.careerpb.CareerInfoGetReply');
    types.GetRechargeInfoRequest = root.lookupType('gamepb.paypb.GetRechargeInfoRequest');
    types.GetRechargeInfoReply = root.lookupType('gamepb.paypb.GetRechargeInfoReply');

    // 农场
    types.AllLandsRequest = root.lookupType('gamepb.plantpb.AllLandsRequest');
    types.AllLandsReply = root.lookupType('gamepb.plantpb.AllLandsReply');
    types.HarvestRequest = root.lookupType('gamepb.plantpb.HarvestRequest');
    types.HarvestReply = root.lookupType('gamepb.plantpb.HarvestReply');
    types.WaterLandRequest = root.lookupType('gamepb.plantpb.WaterLandRequest');
    types.WaterLandReply = root.lookupType('gamepb.plantpb.WaterLandReply');
    types.FarmingRequest = root.lookupType('gamepb.plantpb.FarmingRequest');
    types.FarmingReply = root.lookupType('gamepb.plantpb.FarmingReply');
    types.WeedOutRequest = root.lookupType('gamepb.plantpb.WeedOutRequest');
    types.WeedOutReply = root.lookupType('gamepb.plantpb.WeedOutReply');
    types.InsecticideRequest = root.lookupType('gamepb.plantpb.InsecticideRequest');
    types.InsecticideReply = root.lookupType('gamepb.plantpb.InsecticideReply');
    types.RemovePlantRequest = root.lookupType('gamepb.plantpb.RemovePlantRequest');
    types.RemovePlantReply = root.lookupType('gamepb.plantpb.RemovePlantReply');
    types.PutInsectsRequest = root.lookupType('gamepb.plantpb.PutInsectsRequest');
    types.PutInsectsReply = root.lookupType('gamepb.plantpb.PutInsectsReply');
    types.PutWeedsRequest = root.lookupType('gamepb.plantpb.PutWeedsRequest');
    types.PutWeedsReply = root.lookupType('gamepb.plantpb.PutWeedsReply');
    types.PutSocialItemRequest = root.lookupType('gamepb.plantpb.PutSocialItemRequest');
    types.PutSocialItemReply = root.lookupType('gamepb.plantpb.PutSocialItemReply');
    types.UpgradeLandRequest = root.lookupType('gamepb.plantpb.UpgradeLandRequest');
    types.UpgradeLandReply = root.lookupType('gamepb.plantpb.UpgradeLandReply');
    types.UnlockLandRequest = root.lookupType('gamepb.plantpb.UnlockLandRequest');
    types.UnlockLandReply = root.lookupType('gamepb.plantpb.UnlockLandReply');
    types.CheckCanOperateRequest = root.lookupType('gamepb.plantpb.CheckCanOperateRequest');
    types.CheckCanOperateReply = root.lookupType('gamepb.plantpb.CheckCanOperateReply');
    types.FertilizeRequest = root.lookupType('gamepb.plantpb.FertilizeRequest');
    types.FertilizeReply = root.lookupType('gamepb.plantpb.FertilizeReply');

    // 背包/仓库
    types.BagRequest = root.lookupType('gamepb.itempb.BagRequest');
    types.BagReply = root.lookupType('gamepb.itempb.BagReply');
    types.SellRequest = root.lookupType('gamepb.itempb.SellRequest');
    types.SellReply = root.lookupType('gamepb.itempb.SellReply');
    types.UseRequest = root.lookupType('gamepb.itempb.UseRequest');
    types.UseReply = root.lookupType('gamepb.itempb.UseReply');
    types.BatchUseRequest = root.lookupType('gamepb.itempb.BatchUseRequest');
    types.LockItemsRequest = root.lookupType('gamepb.itempb.LockItemsRequest');
    types.LockItemsReply = root.lookupType('gamepb.itempb.LockItemsReply');
    types.UnlockItemsRequest = root.lookupType('gamepb.itempb.UnlockItemsRequest');
    types.UnlockItemsReply = root.lookupType('gamepb.itempb.UnlockItemsReply');
    types.BatchUseReply = root.lookupType('gamepb.itempb.BatchUseReply');
    types.PlantRequest = root.lookupType('gamepb.plantpb.PlantRequest');
    types.PlantReply = root.lookupType('gamepb.plantpb.PlantReply');
    types.PlantItem = root.lookupType('gamepb.plantpb.PlantItem');

    // 商店
    types.ShopProfilesRequest = root.lookupType('gamepb.shoppb.ShopProfilesRequest');
    types.ShopProfilesReply = root.lookupType('gamepb.shoppb.ShopProfilesReply');
    types.ShopInfoRequest = root.lookupType('gamepb.shoppb.ShopInfoRequest');
    types.ShopInfoReply = root.lookupType('gamepb.shoppb.ShopInfoReply');
    types.BuyGoodsRequest = root.lookupType('gamepb.shoppb.BuyGoodsRequest');
    types.BuyGoodsReply = root.lookupType('gamepb.shoppb.BuyGoodsReply');
    types.GetMonthCardInfosRequest = root.lookupType('gamepb.mallpb.GetMonthCardInfosRequest');
    types.GetMonthCardInfosReply = root.lookupType('gamepb.mallpb.GetMonthCardInfosReply');
    types.ClaimMonthCardRewardRequest = root.lookupType('gamepb.mallpb.ClaimMonthCardRewardRequest');
    types.ClaimMonthCardRewardReply = root.lookupType('gamepb.mallpb.ClaimMonthCardRewardReply');
    types.GetTodayClaimStatusRequest = root.lookupType('gamepb.redpacketpb.GetTodayClaimStatusRequest');
    types.GetTodayClaimStatusReply = root.lookupType('gamepb.redpacketpb.GetTodayClaimStatusReply');
    types.ClaimRedPacketRequest = root.lookupType('gamepb.redpacketpb.ClaimRedPacketRequest');
    types.ClaimRedPacketReply = root.lookupType('gamepb.redpacketpb.ClaimRedPacketReply');
    types.GetMallListBySlotTypeRequest = root.lookupType('gamepb.mallpb.GetMallListBySlotTypeRequest');
    types.GetMallListBySlotTypeResponse = root.lookupType('gamepb.mallpb.GetMallListBySlotTypeResponse');
    types.MallGoods = root.lookupType('gamepb.mallpb.MallGoods');
    types.PurchaseRequest = root.lookupType('gamepb.mallpb.PurchaseRequest');
    types.PurchaseResponse = root.lookupType('gamepb.mallpb.PurchaseResponse');
    types.GetActiveMysteryNPCRequest = root.lookupType('gamepb.mysteryshoppb.GetActiveNPCRequest');
    types.GetActiveMysteryNPCReply = root.lookupType('gamepb.mysteryshoppb.GetActiveNPCReply');
    types.BuyMysteryShopRequest = root.lookupType('gamepb.mysteryshoppb.BuyRequest');
    types.BuyMysteryShopReply = root.lookupType('gamepb.mysteryshoppb.BuyReply');
    types.AbandonMysteryShopRequest = root.lookupType('gamepb.mysteryshoppb.AbandonRequest');
    types.AbandonMysteryShopReply = root.lookupType('gamepb.mysteryshoppb.AbandonReply');
    types.RefreshVipInfoRequest = root.lookupType('gamepb.qqvippb.RefreshVipInfoRequest');
    types.RefreshVipInfoReply = root.lookupType('gamepb.qqvippb.RefreshVipInfoReply');
    types.GetQQVipRewardsStatusRequest = root.lookupType('gamepb.qqvippb.GetQQVipRewardsStatusRequest');
    types.GetQQVipRewardsStatusReply = root.lookupType('gamepb.qqvippb.GetQQVipRewardsStatusReply');
    types.ClaimQQVipRewardsRequest = root.lookupType('gamepb.qqvippb.ClaimQQVipRewardsRequest');
    types.ClaimQQVipRewardsReply = root.lookupType('gamepb.qqvippb.ClaimQQVipRewardsReply');
    types.CheckCanShareRequest = root.lookupType('gamepb.sharepb.CheckCanShareRequest');
    types.CheckCanShareReply = root.lookupType('gamepb.sharepb.CheckCanShareReply');
    types.ReportShareRequest = root.lookupType('gamepb.sharepb.ReportShareRequest');
    types.ReportShareReply = root.lookupType('gamepb.sharepb.ReportShareReply');
    types.ClaimShareRewardRequest = root.lookupType('gamepb.sharepb.ClaimShareRewardRequest');
    types.ClaimShareRewardReply = root.lookupType('gamepb.sharepb.ClaimShareRewardReply');
    types.GetIllustratedListV2Request = root.lookupType('gamepb.illustratedpb.GetIllustratedListV2Request');
    types.GetIllustratedListV2Reply = root.lookupType('gamepb.illustratedpb.GetIllustratedListV2Reply');
    types.ClaimAllRewardsV2Request = root.lookupType('gamepb.illustratedpb.ClaimAllRewardsV2Request');
    types.ClaimAllRewardsV2Reply = root.lookupType('gamepb.illustratedpb.ClaimAllRewardsV2Reply');
    types.CoreItem = root.lookupType('corepb.Item');

    // 活动
    types.ActivityGetGroupRequest = root.lookupType('gamepb.activitypb.GetGroupRequest');
    types.ActivityGetGroupReply = root.lookupType('gamepb.activitypb.GetGroupReply');
    types.ActivityOperateRequest = root.lookupType('gamepb.activitypb.OperateRequest');
    types.ActivityOperateReply = root.lookupType('gamepb.activitypb.OperateReply');
    // 萌宠成长日记（S3）操作协议，来自官方小程序 1.14.0.1 编码器
    for (const name of ['PetDiaryOperateRequest', 'PetDiaryOperateReply', 'PetDiaryGetGroupReply']) {
        types[name] = root.lookupType(`gamepb.activitypb.${name}`);
    }
    types.ActivityRandomShopInfo = root.lookupType('gamepb.activitypb.RandomShopInfo');
    types.ActivityExchangeShopInfo = root.lookupType('gamepb.activitypb.ExchangeShopInfo');
    types.ActivityExchangeShopOperateParams = root.lookupType('gamepb.activitypb.ExchangeShopOperateParams');
    types.ActivityDrawInfo = root.lookupType('gamepb.activitypb.DrawInfo');
    types.ActivityDrawResult = root.lookupType('gamepb.activitypb.DrawResult');
    types.ActivityQingmeiClaimParams = root.lookupType('gamepb.activitypb.QingmeiClaimParams');
    types.ActivityQingmeiWineStartParams = root.lookupType('gamepb.activitypb.QingmeiWineStartParams');
    types.ActivityQingmeiWineBrewParams = root.lookupType('gamepb.activitypb.QingmeiWineBrewParams');
    types.ActivityQingmeiWineSellParams = root.lookupType('gamepb.activitypb.QingmeiWineSellParams');
    types.ActivityQingmeiPreviewResult = root.lookupType('gamepb.activitypb.QingmeiPreviewResult');
    types.ActivityQingmeiBrewResult = root.lookupType('gamepb.activitypb.QingmeiBrewResult');
    types.ActivityQingmeiSellResult = root.lookupType('gamepb.activitypb.QingmeiSellResult');
    types.ActivityQingmeiClaimResult = root.lookupType('gamepb.activitypb.QingmeiClaimResult');
    types.ActivityActivityInfo = root.lookupType('gamepb.activitypb.ActivityInfo');
    types.ActivityListRequest = root.lookupType('gamepb.activitypb.ListRequest');
    types.ActivityListReply = root.lookupType('gamepb.activitypb.ListReply');
    types.ActivityStarRecordInfo = root.lookupType('gamepb.activitypb.StarRecordInfo');
    types.ActivityStarRecordClaimResult = root.lookupType('gamepb.activitypb.StarRecordClaimResult');
    types.ActivityBodyPetDiary = root.lookupType('gamepb.activitypb.ActivityBodyPetDiary');
    types.ActivityPetDiaryPhotoWall = root.lookupType('gamepb.activitypb.PetDiaryPhotoWall');
    types.ActivityPetDiaryPhotoEntry = root.lookupType('gamepb.activitypb.PetDiaryPhotoEntry');

    // 天气
    types.GetWeatherStatusRequest = root.lookupType('gamepb.weatherpb.GetWeatherStatusRequest');
    types.GetWeatherStatusReply = root.lookupType('gamepb.weatherpb.GetWeatherStatusReply');

    // 好友
    types.GetAllFriendsRequest = root.lookupType('gamepb.friendpb.GetAllRequest');
    types.GetAllFriendsReply = root.lookupType('gamepb.friendpb.GetAllReply');
    types.GetApplicationsRequest = root.lookupType('gamepb.friendpb.GetApplicationsRequest');
    types.GetApplicationsReply = root.lookupType('gamepb.friendpb.GetApplicationsReply');
    types.AcceptFriendsRequest = root.lookupType('gamepb.friendpb.AcceptFriendsRequest');
    types.AcceptFriendsReply = root.lookupType('gamepb.friendpb.AcceptFriendsReply');
    types.SyncAllFriendsRequest = root.lookupType('gamepb.friendpb.SyncAllRequest');
    types.SyncAllFriendsReply = root.lookupType('gamepb.friendpb.SyncAllReply');
    types.GetGameFriendsRequest = root.lookupType('gamepb.friendpb.GetGameFriendsRequest');
    types.DelFriendRequest = root.lookupType('gamepb.friendpb.DelFriendRequest');
    types.DelFriendReply = root.lookupType('gamepb.friendpb.DelFriendReply');

    // 访问
    types.VisitEnterRequest = root.lookupType('gamepb.visitpb.EnterRequest');
    types.VisitEnterReply = root.lookupType('gamepb.visitpb.EnterReply');
    types.VisitLeaveRequest = root.lookupType('gamepb.visitpb.LeaveRequest');
    types.VisitLeaveReply = root.lookupType('gamepb.visitpb.LeaveReply');
    types.BriefDogInfo = root.lookupType('gamepb.visitpb.BriefDogInfo');
    types.GetDogInfoRequest = root.lookupType('gamepb.dogpb.GetDogInfoRequest');
    types.GetDogInfoReply = root.lookupType('gamepb.dogpb.GetDogInfoReply');
    types.ClaimSkillGiftsRequest = root.lookupType('gamepb.dogpb.ClaimSkillGiftsRequest');
    types.ClaimSkillGiftsReply = root.lookupType('gamepb.dogpb.ClaimSkillGiftsReply');
    types.PendingGiftCountNotify = root.lookupType('gamepb.dogpb.PendingGiftCountNotify');
    types.DeployDogRequest = root.lookupType('gamepb.dogpb.DeployDogRequest');
    types.DeployDogReply = root.lookupType('gamepb.dogpb.DeployDogReply');
    types.WithdrawDogRequest = root.lookupType('gamepb.dogpb.WithdrawDogRequest');
    types.WithdrawDogReply = root.lookupType('gamepb.dogpb.WithdrawDogReply');
    types.AddFoodRequest = root.lookupType('gamepb.dogpb.AddFoodRequest');
    types.AddFoodReply = root.lookupType('gamepb.dogpb.AddFoodReply');
    types.GetProtectLogsRequest = root.lookupType('gamepb.dogpb.GetProtectLogsRequest');
    types.GetProtectLogsReply = root.lookupType('gamepb.dogpb.GetProtectLogsReply');


    // 任务
    types.TaskInfoRequest = root.lookupType('gamepb.taskpb.TaskInfoRequest');
    types.TaskInfoReply = root.lookupType('gamepb.taskpb.TaskInfoReply');
    types.ClaimTaskRewardRequest = root.lookupType('gamepb.taskpb.ClaimTaskRewardRequest');
    types.ClaimTaskRewardReply = root.lookupType('gamepb.taskpb.ClaimTaskRewardReply');
    types.BatchClaimTaskRewardRequest = root.lookupType('gamepb.taskpb.BatchClaimTaskRewardRequest');
    types.BatchClaimTaskRewardReply = root.lookupType('gamepb.taskpb.BatchClaimTaskRewardReply');
    types.ClaimDailyRewardRequest = root.lookupType('gamepb.taskpb.ClaimDailyRewardRequest');
    types.ClaimDailyRewardReply = root.lookupType('gamepb.taskpb.ClaimDailyRewardReply');

    // 邮箱
    types.GetEmailListRequest = root.lookupType('gamepb.emailpb.GetEmailListRequest');
    types.GetEmailListReply = root.lookupType('gamepb.emailpb.GetEmailListReply');
    types.ClaimEmailRequest = root.lookupType('gamepb.emailpb.ClaimEmailRequest');
    types.ClaimEmailReply = root.lookupType('gamepb.emailpb.ClaimEmailReply');
    types.BatchClaimEmailRequest = root.lookupType('gamepb.emailpb.BatchClaimEmailRequest');
    types.BatchClaimEmailReply = root.lookupType('gamepb.emailpb.BatchClaimEmailReply');

    // 服务器推送通知
    types.LandsNotify = root.lookupType('gamepb.plantpb.LandsNotify');
    types.BasicNotify = root.lookupType('gamepb.userpb.BasicNotify');
    types.KickoutNotify = root.lookupType('gatepb.KickoutNotify');
    types.FriendApplicationReceivedNotify = root.lookupType('gamepb.friendpb.FriendApplicationReceivedNotify');
    types.FriendAddedNotify = root.lookupType('gamepb.friendpb.FriendAddedNotify');
    types.InteractRecordsRequest = root.lookupType('gamepb.interactpb.InteractRecordsRequest');
    types.InteractRecordsReply = root.lookupType('gamepb.interactpb.InteractRecordsReply');
    types.ItemNotify = root.lookupType('gamepb.itempb.ItemNotify');
    types.RechargeInfoNotify = root.lookupType('gamepb.paypb.RechargeInfoNotify');
    types.GoodsUnlockNotify = root.lookupType('gamepb.shoppb.GoodsUnlockNotify');
    types.TaskInfoNotify = root.lookupType('gamepb.taskpb.TaskInfoNotify');

    // 宠物
    types.ActivateDogRequest = root.lookupType('gamepb.dogpb.ActivateDogRequest');
    types.ActivateDogReply = root.lookupType('gamepb.dogpb.ActivateDogReply');

    // 所有消息类型都挂到 types 之后才算就绪。waitForProtoReady 依据 protoReady 放行，
    // 不能依据 root：root 在 `await root.load(...)` 返回时就已经非空，而这时 types 还是空的，
    // 窗口内的 encode/decode 会抛 "Cannot read properties of undefined (reading 'encode')"。
    protoReady = true;

    // Proto 加载完成
    log('系统', 'Protobuf 定义加载完成');
}

/**
 * 对外入口：无论加载成功还是失败都要唤醒 waitForProtoReady 的等待方，
 * 否则加载失败时等待方会永久挂起。失败时 protoReady 仍为 false，
 * 等待方会据此拿到明确错误，而不是让底层 encode 抛空指针。
 */
async function loadProto() {
    try {
        return await loadProtoInner();
    } finally {
        notifyProtoWaiters();
    }
}

function getRoot() {
    return root;
}

/** 消息类型是否已全部就绪（供诊断与守卫使用） */
function isProtoReady() {
    return protoReady;
}

/**
 * 等待消息类型就绪。未就绪时挂起，加载成功后被放行，加载失败或等待超时则抛出可读错误。
 * @param {number} [timeoutMs] - 等待上限，默认 8 秒
 */
function waitForProtoReady(timeoutMs = PROTO_WAIT_TIMEOUT_MS) {
    if (protoReady) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
            const index = protoReadyWaiters.indexOf(waiter);
            if (index >= 0) protoReadyWaiters.splice(index, 1);
            reject(new Error('等待 Protobuf 定义加载超时'));
        }, timeoutMs);
        protoReadyWaiters.push(waiter);
    });
}

module.exports = { loadProto, types, getRoot, waitForProtoReady, isProtoReady };
