import { Router } from 'express';
import prisma from '../prisma.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// Сортировка отзывов
const REVIEW_ORDER = {
  date:        { createdAt: 'desc' },
  rating:      { rating: 'desc' },
  helpfulness: { likes: 'desc' },
};

// ─── GET /api/products ────────────────────────────────────────────────────────
// Поиск/листинг: ?q=&categoryId=&minPrice=&maxPrice=&sort=price_asc|price_desc|rating&limit=&offset=
router.get('/', async (req, res) => {
  const { q, categoryId, minPrice, maxPrice, sort, limit = 20, offset = 0 } = req.query;

  const where = {};

  if (categoryId) where.categoryId = Number(categoryId);
  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) where.price.gte = Number(minPrice);
    if (maxPrice) where.price.lte = Number(maxPrice);
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { sku:  { contains: q, mode: 'insensitive' } },
    ];
  }

  const orderBy =
    sort === 'price_asc'  ? { price: 'asc' }  :
    sort === 'price_desc' ? { price: 'desc' } :
    sort === 'rating'     ? { rating: 'desc' } :
    /* default */           { name: 'asc' };

  try {
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        take: Number(limit),
        skip: Number(offset),
        orderBy,
        select: {
          id: true, sku: true, name: true, price: true, oldPrice: true,
          stock: true, images: true, unit: true, rating: true, reviewCount: true,
          weight: true, categoryId: true,
        },
      }),
      prisma.product.count({ where }),
    ]);
    res.json({ products, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка поиска товаров' });
  }
});

// ─── GET /api/products/:id ────────────────────────────────────────────────────
// Карточка товара с характеристиками, вариациями, аналогами и отзывами
// ?reviewSort=date|rating|helpfulness
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const reviewSort = req.query.reviewSort || 'date';
  const reviewOrderBy = REVIEW_ORDER[reviewSort] ?? REVIEW_ORDER.date;

  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          include: {
            parent: { include: { parent: true } }, // L3 → L2 → L1 (хлебные крошки)
          },
        },
        variations: {
          select: { id: true, name: true, images: true, price: true, stock: true },
        },
        mainProduct: {
          select: { id: true, name: true },
        },
        reviews: {
          orderBy: reviewOrderBy,
          take: 10,
          include: {
            user: { select: { fullName: true } },
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: 'Товар не найден' });

    // Подтягиваем аналоги отдельным запросом (т.к. relatedProductIds — массив Int[])
    const relatedProducts =
      product.relatedProductIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: product.relatedProductIds } },
            select: { id: true, name: true, images: true, price: true, oldPrice: true, rating: true, reviewCount: true, unit: true },
          })
        : [];

    res.json({ ...product, relatedProducts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения товара' });
  }
});

// ─── GET /api/products/:id/reviews ───────────────────────────────────────────
// Все отзывы с пагинацией и сортировкой: ?sort=date|rating|helpfulness
router.get('/:id/reviews', async (req, res) => {
  const productId = Number(req.params.id);
  const sort = req.query.sort || 'date';
  const limit = Number(req.query.limit ?? 20);
  const offset = Number(req.query.offset ?? 0);

  const orderBy = REVIEW_ORDER[sort] ?? REVIEW_ORDER.date;

  try {
    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { productId },
        orderBy,
        take: limit,
        skip: offset,
        include: { user: { select: { fullName: true } } },
      }),
      prisma.review.count({ where: { productId } }),
    ]);
    res.json({ reviews, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения отзывов' });
  }
});

// ─── POST /api/products/:id/reviews ──────────────────────────────────────────
// Создать отзыв (авторизация обязательна)
// Body: { rating, pros?, cons?, comment?, usageTime, media? }
router.post('/:id/reviews', authenticate, async (req, res) => {
  const productId = Number(req.params.id);
  const { rating, pros, cons, comment, usageTime, media = [] } = req.body;

  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'rating должен быть от 1 до 5' });
  if (!usageTime)
    return res.status(400).json({ error: 'usageTime обязателен' });

  try {
    const review = await prisma.$transaction(async (tx) => {
      const r = await tx.review.create({
        data: { userId: req.userId, productId, rating, pros, cons, comment, usageTime, media },
        include: { user: { select: { fullName: true } } },
      });

      // Пересчитываем rating и reviewCount на продукте
      const agg = await tx.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { id: true },
      });

      await tx.product.update({
        where: { id: productId },
        data: {
          rating:      Math.round((agg._avg.rating ?? 0) * 10) / 10,
          reviewCount: agg._count.id,
        },
      });

      return r;
    });

    res.status(201).json(review);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка создания отзыва' });
  }
});

// ─── POST /api/reviews/:reviewId/vote ────────────────────────────────────────
// Проголосовать за полезность: Body: { vote: "like" | "dislike" }
router.post('/reviews/:reviewId/vote', authenticate, async (req, res) => {
  const reviewId = Number(req.params.reviewId);
  const { vote } = req.body;

  if (vote !== 'like' && vote !== 'dislike')
    return res.status(400).json({ error: 'vote должен быть "like" или "dislike"' });

  const data = vote === 'like' ? { likes: { increment: 1 } } : { dislikes: { increment: 1 } };

  try {
    const review = await prisma.review.update({
      where: { id: reviewId },
      data,
      select: { id: true, likes: true, dislikes: true },
    });
    res.json(review);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка голосования' });
  }
});

export default router;
