import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';

const router = Router();

// ─── Хелперы ─────────────────────────────────────────────────────────────────

// Экранирует спецсимволы ILIKE: %, _, \
function escapeLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

// Строит «Хлебные крошки» из цепочки категорий L1 › L2 › L3
function buildBreadcrumb(category) {
  if (!category) return '';
  const parts = [];
  if (category.parent?.parent) parts.push(category.parent.parent.name);
  if (category.parent) parts.push(category.parent.name);
  parts.push(category.name);
  return parts.join(' › ');
}

// ─── Ядро поиска: raw SQL с pg_trgm ─────────────────────────────────────────
// Возвращает массив { id, score }[], отсортированный по релевантности.
// Учитывает: name, sku, characteristics::text (бренд и другие атрибуты).
// Опечатки обрабатываются через similarity() из расширения pg_trgm.
async function findProductIds(q, { limit = 20, offset = 0 } = {}) {
  const likePattern = `%${escapeLike(q)}%`;
  const simThreshold = 0.2; // порог схожести (0 = разные, 1 = идентичны)

  const rows = await prisma.$queryRaw`
    SELECT
      p.id::int                             AS id,
      COUNT(*) OVER ()::int                 AS total,
      GREATEST(
        similarity(p.name,                ${q}),
        similarity(COALESCE(p.sku, ''),   ${q})
      )                                     AS score
    FROM "Product" p
    WHERE
      p.name                      ILIKE ${likePattern}
      OR COALESCE(p.sku, '')      ILIKE ${likePattern}
      OR p.characteristics::text  ILIKE ${likePattern}
      OR similarity(p.name,               ${q}) > ${simThreshold}
      OR similarity(COALESCE(p.sku, ''),  ${q}) > ${simThreshold}
    ORDER BY score DESC, p.rating DESC
    LIMIT  ${limit}
    OFFSET ${offset}
  `;

  const total    = rows.length > 0 ? Number(rows[0].total) : 0;
  const ids      = rows.map((r) => Number(r.id));
  // Ключи scoreMap — числа (Number), чтобы lookup по p.id из Prisma ORM совпадал
  const scoreMap = Object.fromEntries(rows.map((r) => [Number(r.id), Number(r.score)]));

  return { ids, total, scoreMap };
}

// Поиск по категориям (name)
async function findCategories(q, limit = 5) {
  const likePattern = `%${escapeLike(q)}%`;

  const rows = await prisma.$queryRaw`
    SELECT
      c.id::int       AS id,
      c.name          AS name,
      c.slug          AS slug,
      c.level::int    AS level,
      c."parentId"    AS "parentId",
      similarity(c.name, ${q}) AS score
    FROM "Category" c
    WHERE
      c.name ILIKE ${likePattern}
      OR similarity(c.name, ${q}) > 0.25
    ORDER BY score DESC, c.level ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

// ─── GET /api/search ──────────────────────────────────────────────────────────
// Полный поиск: ?query=...&limit=20&offset=0
// Ответ: { products: [...], total, query }
router.get('/', async (req, res) => {
  const q      = (req.query.query ?? '').trim();
  const limit  = Math.min(Number(req.query.limit  ?? 20), 100);
  const offset = Number(req.query.offset ?? 0);

  if (!q) return res.json({ products: [], total: 0, query: '' });

  try {
    const { ids, total, scoreMap } = await findProductIds(q, { limit, offset });

    if (ids.length === 0) return res.json({ products: [], total: 0, query: q });

    // Загружаем полные данные товаров с категорией (хлебные крошки)
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true, sku: true,
        price: true, oldPrice: true,
        images: true, rating: true, reviewCount: true,
        stock: true, unit: true, weight: true,
        category: {
          include: {
            parent: { include: { parent: true } },
          },
        },
      },
    });

    // Восстанавливаем порядок и добавляем breadcrumb + score
    const sorted = ids
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({
        ...p,
        breadcrumb: buildBreadcrumb(p.category),
        score:      scoreMap[p.id] ?? 0,
      }));

    res.json({ products: sorted, total, query: q });
  } catch (error) {
    console.error('[search]', error);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// ─── GET /api/search/suggestions ─────────────────────────────────────────────
// Живые подсказки: ?query=...  (минимум 3 символа)
// Ответ: { products: [top-5 с breadcrumb], categories: [top-3] }
router.get('/suggestions', async (req, res) => {
  const q = (req.query.query ?? '').trim();

  if (q.length < 3) return res.json({ products: [], categories: [] });

  try {
    const [{ ids, scoreMap }, categoryRows] = await Promise.all([
      findProductIds(q, { limit: 5, offset: 0 }),
      findCategories(q, 3),
    ]);

    // Загружаем товары (5 шт.) с полной цепочкой категорий для крошек
    const products =
      ids.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: ids } },
            select: {
              id: true, name: true, sku: true,
              price: true, images: true,
              stock: true, unit: true,
              category: {
                include: { parent: { include: { parent: true } } },
              },
            },
          })
        : [];

    // Восстанавливаем порядок релевантности
    const sortedProducts = ids
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({
        id:         p.id,
        name:       p.name,
        sku:        p.sku,
        price:      p.price,
        image:      p.images?.[0] ?? null,
        stock:      p.stock,
        unit:       p.unit,
        breadcrumb: buildBreadcrumb(p.category),
        score:      scoreMap[p.id] ?? 0,
      }));

    // Обогащаем категории хлебными крошками (у нас есть parentId в rows)
    // Делаем один запрос, чтобы подтянуть parent-ов для найденных категорий
    const catIds = categoryRows.map((c) => c.id);
    const catsFull =
      catIds.length > 0
        ? await prisma.category.findMany({
            where: { id: { in: catIds } },
            include: { parent: { include: { parent: true } } },
          })
        : [];

    const sortedCategories = categoryRows
      .map((row) => catsFull.find((c) => c.id === row.id))
      .filter(Boolean)
      .map((c) => ({
        id:         c.id,
        name:       c.name,
        slug:       c.slug,
        level:      c.level,
        breadcrumb: buildBreadcrumb(c),
      }));

    res.json({ products: sortedProducts, categories: sortedCategories });
  } catch (error) {
    console.error('[suggestions]', error);
    res.status(500).json({ error: 'Ошибка подсказок' });
  }
});

export default router;
