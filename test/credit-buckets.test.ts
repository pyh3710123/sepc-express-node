import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocateTaskDebits } from '../src/features/generation/generation.service';

test('积分按配置顺序逐任务扣除，未用来源保留供退款', () => {
  const balances = { subscription: 3, recharge: 10, gift: 2 };
  const debits = allocateTaskDebits([7, 6], balances, [2, 1, 3]);
  assert.deepEqual(debits, [
    { subscription: 0, recharge: 7, gift: 0 },
    { subscription: 3, recharge: 3, gift: 0 },
  ]);
  assert.deepEqual(balances, { subscription: 0, recharge: 0, gift: 2 });
  assert.throws(
    () => allocateTaskDebits([3], { subscription: 1, recharge: 0, gift: 0 }, [1, 2, 3]),
    { status: 402 },
  );
  assert.throws(
    () => allocateTaskDebits([1], { subscription: 1, recharge: 0, gift: 0 }, [1, 1, 3]),
    { status: 409 },
  );
});
