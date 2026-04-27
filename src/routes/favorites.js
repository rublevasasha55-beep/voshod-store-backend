import { Router } from 'express';
import prisma from '../prisma.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// ─── GET /api/favorites ───────────────────────────────────────────────────────
// Список избранного текущего пользователя
router.get('/', authenticate, async (req, res) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: {
            id: true, name: true, sku: true, price: true, oldPrice: true,
            images: true, rating: true, reviewCount: true, stock: true, unit: true,
          },
        },
      },
    });
    res.json(favorites);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения избранного' });
  }
});

// ─── POST /api/favorites ──────────────────────────────────────────────────────
// Добавить в избранное (идемпотентно — повторный вызов не даёт ошибку)
// Body: { productId }
router.post('/', authenticate, async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId обязателен' });

  try {
    const favorite = await prisma.favorite.upsert({
      where: { userId_productId: { userId: req.userId, productId: Number(productId) } },
      create: { userId: req.userId, productId: Number(productId) },
      update: {},
      include: { product: { select: { id: true, name: true } } },
    });
    res.status(201).json(favorite);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка добавления в избранное' });
  }
});

// ─── DELETE /api/favorites/:productId ────────────────────────────────────────
// Удалить из избранного
router.delete('/:productId', authenticate, async (req, res) => {
  const productId = Number(req.params.productId);
  try {
    await prisma.favorite.deleteMany({
      where: { userId: req.userId, productId },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления из избранного' });
  }
});

export default router;
