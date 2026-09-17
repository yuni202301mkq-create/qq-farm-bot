const assert = require('node:assert/strict');
const test = require('node:test');

const { loadProto, types } = require('../src/utils/proto');

// 回归：sharepb 字段定义来自抓包确认（qq-farm-bot-master）。
// 旧版 ReportShareRequest 误写为 bool shared 单字段（缺场景码 field_4，
// 服务器拒绝 → 永远卡在「上报分享状态失败」），ReportShareReply 误写为
// bool success（实际是 bytes result），ClaimShareRewardReply 的 items
// 误写在字段 3（实际在字段 1）。

test('share proto wire format matches capture-confirmed encoders', async () => {
  if (!types.ReportShareRequest) await loadProto();

  // 每日礼包上报：field_1=1, field_4=42 → 08 01 20 2a
  const dailyReport = Buffer.from(types.ReportShareRequest.encode(
    types.ReportShareRequest.create({ field_1: 1, field_4: 42 }),
  ).finish()).toString('hex');
  assert.equal(dailyReport, '0801202a');

  // 青梅酿上报：field_1=11, field_4=215 → 08 0b 20 d7 01
  const qingmeiReport = Buffer.from(types.ReportShareRequest.encode(
    types.ReportShareRequest.create({ field_1: 11, field_4: 215 }),
  ).finish()).toString('hex');
  assert.equal(qingmeiReport, '080b20d701');

  // 领取请求：field_1=true → 08 01
  const claim = Buffer.from(types.ClaimShareRewardRequest.encode(
    types.ClaimShareRewardRequest.create({ field_1: true }),
  ).finish()).toString('hex');
  assert.equal(claim, '0801');
});

test('share proto round-trips capture-shaped replies', async () => {
  if (!types.ReportShareReply) await loadProto();

  // ReportShareReply：bytes result（无 success 布尔字段）
  const reportReply = types.ReportShareReply.decode(Buffer.from('0a0206a8', 'hex'));
  assert.ok(Buffer.isBuffer(reportReply.result));

  // ClaimShareRewardReply：items 在字段 1（corepb.Item：id=1, count=2）
  // items[0] = { id: 1001, count: 500 } → 0a 06 08 e9 07 10 f4 03
  const claimReply = types.ClaimShareRewardReply.decode(Buffer.from('0a0608e90710f403', 'hex'));
  assert.equal(claimReply.items.length, 1);
  assert.equal(Number(claimReply.items[0].id), 1001);
  assert.equal(Number(claimReply.items[0].count), 500);
});
