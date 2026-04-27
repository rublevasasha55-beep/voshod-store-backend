import { Router } from 'express';
import prisma from '../prisma.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// Хелпер: получить (или создать) корзину текущего пользователя
async function getOrCreateCart(userId) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    include: {
      items: {
        include: { product: true },
        orderBy: { id: 'asc' },
      },
    },
  });
}

// ─── GET /api/cart ─────────────────────────────────────────────────────────────
// Возвращает корзину с позициями
router.get('/', authenticate, async (req, res) => {
  try {
    const cart = await getOrCreateCart(req.userId);
    res.json(cart);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения корзины' });
  }
});

// ─── POST /api/cart/items ──────────────────────────────────────────────────────
// Добавить товар в корзину (или увеличить quantity)
// Body: { productId, quantity? }
router.post('/items', authenticate, async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId обязателен' });

  try {
    const cart = await prisma.cart.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId },
      update: {},
    });

    const item = await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity },
      update: { quantity: { increment: quantity } },
      include: { product: true },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка добавления товара в корзину' });
  }
});

// ─── PATCH /api/cart/items/:itemId ────────────────────────────────────────────
// Обновить quantity и/или isSelected одной позиции
// Body: { quantity?, isSelected? }
router.patch('/items/:itemId', authenticate, async (req, res) => {
  const itemId = Number(req.params.itemId);
  const { quantity, isSelected } = req.body;

  try {
    // Убедимся, что позиция принадлежит текущему пользователю
    const existing = await prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId: req.userId } },
    });
    if (!existing) return res.status(404).json({ error: 'Позиция не найдена' });

    const data = {};
    if (quantity !== undefined) data.quantity = quantity;
    if (isSelected !== undefined) data.isSelected = isSelected;

    const item = await prisma.cartItem.update({
      where: { id: itemId },
      data,
      include: { product: true },
    });
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обновления позиции корзины' });
  }
});

// ─── PATCH /api/cart/items/select-all ─────────────────────────────────────────
// Выбрать / снять выбор со всех позиций
// Body: { isSelected }
router.patch('/items/select-all', authenticate, async (req, res) => {
  const { isSelected } = req.body;
  if (typeof isSelected !== 'boolean')
    return res.status(400).json({ error: 'isSelected должен быть boolean' });

  try {
    const cart = await prisma.cart.findUnique({ where: { userId: req.userId } });
    if (!cart) return res.json({ updated: 0 });

    const result = await prisma.cartItem.updateMany({
      where: { cartId: cart.id },
      data: { isSelected },
    });
    res.json({ updated: result.count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка массового выбора' });
  }
});

// ─── DELETE /api/cart/items/:itemId ───────────────────────────────────────────
// Удалить одну позицию
router.delete('/items/:itemId', authenticate, async (req, res) => {
  const itemId = Number(req.params.itemId);

  try {
    const existing = await prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId: req.userId } },
    });
    if (!existing) return res.status(404).json({ error: 'Позиция не найдена' });

    await prisma.cartItem.delete({ where: { id: itemId } });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления позиции' });
  }
});

// ─── DELETE /api/cart/items/selected ──────────────────────────────────────────
// Удалить все выбранные (isSelected=true) позиции
router.delete('/items/selected', authenticate, async (req, res) => {
  try {
    const cart = await prisma.cart.findUnique({ where: { userId: req.userId } });
    if (!cart) return res.json({ deleted: 0 });

    const result = await prisma.cartItem.deleteMany({
      where: { cartId: cart.id, isSelected: true },
    });
    res.json({ deleted: result.count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления выбранных позиций' });
  }
});

export default router;
