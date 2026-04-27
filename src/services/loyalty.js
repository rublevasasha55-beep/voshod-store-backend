import prisma from '../prisma.js';

const CASHBACK_RATE = 0.07; // 7% от суммы покупки

/**
 * Начислить баллы за покупку.
 * @param {number} userId
 * @param {number} purchaseAmountRub - сумма покупки в рублях
 * @returns {{ pointsAdded: number, newBalance: number }}
 */
export async function addBonus(userId, purchaseAmountRub) {
  const points = Math.floor(purchaseAmountRub * CASHBACK_RATE);
  if (points <= 0) return { pointsAdded: 0, newBalance: null };

  const [, updatedUser] = await prisma.$transaction([
    prisma.loyaltyTransaction.create({
      data: { userId, amount: points, type: 'CREDIT' },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { bonusPoints: { increment: points } },
    }),
  ]);

  return { pointsAdded: points, newBalance: updatedUser.bonusPoints };
}

/**
 * Списать баллы при оплате (1 балл = 1 рубль, можно оплатить 100%).
 * Бросает ошибку, если баллов не хватает — баланс никогда не уйдёт в минус.
 * @param {number} userId
 * @param {number} pointsToUse - сколько баллов списать
 * @returns {{ pointsUsed: number, newBalance: number }}
 */
export async function payWithPoints(userId, pointsToUse) {
  if (pointsToUse <= 0) {
    throw new Error('Количество баллов должно быть положительным');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Пользователь не найден');

  if (user.bonusPoints < pointsToUse) {
    throw new Error(`Недостаточно баллов. Доступно: ${user.bonusPoints}`);
  }

  const [, updatedUser] = await prisma.$transaction([
    prisma.loyaltyTransaction.create({
      data: { userId, amount: pointsToUse, type: 'DEBIT' },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { bonusPoints: { decrement: pointsToUse } },
    }),
  ]);

  return { pointsUsed: pointsToUse, newBalance: updatedUser.bonusPoints };
}

/**
 * История транзакций пользователя.
 */
export async function getHistory(userId) {
  return prisma.loyaltyTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}
