import { Router } from 'express';
import prisma from '../prisma.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

const MAX_ITEMS = 4; // Ограничение макета

// ─── Хелперы ─────────────────────────────────────────────────────────────────

/**
 * Для каждого ключа характеристик определяет, различаются ли значения
 * между товарами в группе.
 * diffMap[key] = true  → строка «различается» (показывать в режиме «Только отличия»)
 * diffMap[key] = false → строка «одинакова» (скрыть в режиме «Только отличия»)
 */
function computeDiffMap(products) {
  if (products.length <= 1) return {};

  const allKeys = new Set(
    products.flatMap((p) => Object.keys(p.characteristics ?? {})),
  );

  const diffMap = {};
  for (const key of allKeys) {
    const values = products.map((p) => {
      const v = p.characteristics?.[key];
      return v == null ? '' : String(v).trim().toLowerCase();
    });
    diffMap[key] = new Set(values).size > 1;
  }
  return diffMap;
}

/**
 * Группирует список товаров по L3-категории и вычисляет diffMap в каждой группе.
 * Возвращает массив групп: { categoryId, categoryName, products, diffMap }
 */
function groupByCategory(products) {
  const map = new Map();

  for (const p of products) {
    const catId   = p.category?.id   ?? 0;
    const catName = p.category?.name ?? 'Без категории';

    if (!map.has(catId)) {
      map.set(catId, { categoryId: catId, categoryName: catName, products: [] });
    }
    map.get(catId).products.push(p);
  }

  return Array.from(map.values()).map((g) => ({
    ...g,
    diffMap: computeDiffMap(g.products),
  }));
}

// Набор полей товара для сравнения (характеристики включены)
const PRODUCT_SELECT = {
  id: true, name: true, sku: true,
  price: true, oldPrice: true,
  images: true, rating: true, reviewCount: true,
  stock: true, unit: true, weight: true,
  characteristics: true,
  category: { select: { id: true, name: true, slug: true, level: true } },
};

// ─── GET /api/comparison ──────────────────────────────────────────────────────
// Список сравнения авторизованного пользователя.
// Ответ: { groups: [{categoryId, categoryName, products, diffMap}], total }
router.get('/', authenticate, async (req, res) => {
  try {
    const items = await prisma.comparisonItem.findMany({
      where:   { userId: req.userId },
      orderBy: { createdAt: 'asc' },
      include: { product: { select: PRODUCT_SELECT } },
    });

    const products = items.map((i) => i.product);
    const groups   = groupByCategory(products);

    res.json({ groups, total: products.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения списка сравнения' });
  }
});

// ─── POST /api/comparison/guest ───────────────────────────────────────────────
// Публичный эндпоинт для ГОСТЕЙ: принимает массив ID из localStorage,
// возвращает сгруппированные данные с diffMap (без сохранения в БД).
// Body: { productIds: [1, 2, 3] }
router.post('/guest', async (req, res) => {
  const rawIds = req.body.productIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return res.json({ groups: [], total: 0 });
  }

  const ids = rawIds.slice(0, MAX_ITEMS).map(Number).filter(Boolean);

  try {
    const products = await prisma.product.findMany({
      where:   { id: { in: ids } },
      select:  PRODUCT_SELECT,
      orderBy: { name: 'asc' },
    });

    res.json({ groups: groupByCategory(products), total: products.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения данных сравнения' });
  }
});

// ─── POST /api/comparison/merge ───────────────────────────────────────────────
// Склейка при логине: переносит ID из гостевого localStorage в аккаунт.
// Body: { productIds: [1, 2, 3] }
router.post('/merge', authenticate, async (req, res) => {
  const rawIds = req.body.productIds;

  if (Array.isArray(rawIds) && rawIds.length > 0) {
    const existing = await prisma.comparisonItem.count({ where: { userId: req.userId } });
    const canAdd   = Math.max(0, MAX_ITEMS - existing);
    const toAdd    = rawIds.slice(0, canAdd).map(Number).filter(Boolean);

    if (toAdd.length > 0) {
      try {
        await prisma.$transaction(
          toAdd.map((productId) =>
            prisma.comparisonItem.upsert({
              where:  { userId_productId: { userId: req.userId, productId } },
              create: { userId: req.userId, productId },
              update: {},
            }),
          ),
        );
      } catch (error) {
        console.error('[comparison merge]', error);
      }
    }
  }

  // Возвращаем актуальное состояние после merge
  try {
    const items = await prisma.comparisonItem.findMany({
      where:   { userId: req.userId },
      orderBy: { createdAt: 'asc' },
      include: { product: { select: PRODUCT_SELECT } },
    });

    const products = items.map((i) => i.product);
    res.json({ groups: groupByCategory(products), total: products.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка после слияния' });
  }
});

// ─── POST /api/comparison ─────────────────────────────────────────────────────
// Добавить товар в сравнение (авторизованный)
// Body: { productId }
router.post('/', authenticate, async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId обязателен' });

  try {
    const count = await prisma.comparisonItem.count({ where: { userId: req.userId } });
    if (count >= MAX_ITEMS) {
      return res.status(422).json({ error: `В сравнении не более ${MAX_ITEMS} товаров` });
    }

    const item = await prisma.comparisonItem.upsert({
      where:  { userId_productId: { userId: req.userId, productId: Number(productId) } },
      create: { userId: req.userId, productId: Number(productId) },
      update: {},
      include: { product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } } },
    });
    res.status(201).json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка добавления в сравнение' });
  }
});

// ─── DELETE /api/comparison/:productId ───────────────────────────────────────
router.delete('/:productId', authenticate, async (req, res) => {
  const productId = Number(req.params.productId);
  try {
    await prisma.comparisonItem.deleteMany({ where: { userId: req.userId, productId } });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления из сравнения' });
  }
});

// ─── DELETE /api/comparison ───────────────────────────────────────────────────
router.delete('/', authenticate, async (req, res) => {
  try {
    const result = await prisma.comparisonItem.deleteMany({ where: { userId: req.userId } });
    res.json({ deleted: result.count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка очистки сравнения' });
  }
});

export default router;
