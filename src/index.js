import 'dotenv/config'; // <--- ВОТ СЮДА! Самая первая строка
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './prisma.js';
import authRoutes       from './routes/auth.js';
import cartRoutes       from './routes/cart.js';
import estimateRoutes   from './routes/estimates.js';
import productRoutes    from './routes/products.js';
import favoriteRoutes   from './routes/favorites.js';
import comparisonRoutes from './routes/comparison.js';
import searchRoutes     from './routes/search.js';
import profileRoutes    from './routes/profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── Роуты ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/cart',       cartRoutes);
app.use('/api/estimates',  estimateRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/favorites',  favoriteRoutes);
app.use('/api/comparison', comparisonRoutes);
app.use('/api/search',     searchRoutes);
app.use('/api/profile',    profileRoutes);

// ─── Категории (3-уровневый каталог) ─────────────────────────────────────────

// Полное дерево L1 → L2 → L3
app.get('/api/categories', async (_req, res) => {
  try {
    const roots = await prisma.category.findMany({
      where: { level: 1 },
      orderBy: { name: 'asc' },
      include: {
        children: {
          orderBy: { name: 'asc' },
          include: { children: { orderBy: { name: 'asc' } } },
        },
      },
    });
    res.json(roots);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка при получении категорий' });
  }
});

// Одна категория по slug
app.get('/api/categories/:slug', async (req, res) => {
  try {
    const category = await prisma.category.findUnique({
      where: { slug: req.params.slug },
      include: {
        children: {
          orderBy: { name: 'asc' },
          include: { children: { orderBy: { name: 'asc' } } },
        },
        products: {
          where: { stock: { gt: 0 } },
          orderBy: { name: 'asc' },
          select: {
            id: true, name: true, sku: true, price: true, oldPrice: true,
            images: true, rating: true, reviewCount: true, stock: true, unit: true,
          },
        },
      },
    });
    if (!category) return res.status(404).json({ error: 'Категория не найдена' });
    res.json(category);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка при получении категории' });
  }
});

// Сид: создать L1-категории из готового списка
app.post('/api/setup-categories', async (_req, res) => {
  const rootCategories = [
    { name: 'Сантехника',                    slug: 'plumbing',           image: '/img/categories/plumbing.png' },
    { name: 'Стройматериалы',                slug: 'building-materials', image: '/img/categories/building-materials.png' },
    { name: 'Напольные покрытия',            slug: 'flooring',           image: '/img/categories/flooring.png' },
    { name: 'Инструмент',                    slug: 'tools',              image: '/img/categories/tools.png' },
    { name: 'Электротовары',                 slug: 'electrical',         image: '/img/categories/electrical.png' },
    { name: 'Краски',                        slug: 'paints',             image: '/img/categories/paints.png' },
    { name: 'Столярные изделия',             slug: 'woodworking',        image: '/img/categories/woodworking.png' },
    { name: 'Двери, окна, панели',           slug: 'doors-windows',      image: '/img/categories/doors-windows.png' },
    { name: 'Водоснабжение и водоотведение', slug: 'water-supply',       image: '/img/categories/water-supply.png' },
    { name: 'Скобяные изделия',             slug: 'hardware',           image: '/img/categories/hardware.png' },
    { name: 'Дом и сад',                     slug: 'home-garden',        image: '/img/categories/home-garden.png' },
    { name: 'Декор',                         slug: 'decor',              image: '/img/categories/decor.png' },
    { name: 'Плитка',                        slug: 'tiles',              image: '/img/categories/tiles.png' },
    { name: 'Кухни',                         slug: 'kitchens',           image: '/img/categories/kitchens.png' },
  ];

  try {
    const result = await prisma.category.createMany({
      data: rootCategories.map((c) => ({ ...c, level: 1 })),
      skipDuplicates: true,
    });
    res.json({ message: `Готово. Добавлено разделов: ${result.count}`, count: result.count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка при заполнении категорий' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

async function bootstrap() {
  // pg_trgm нужен для нечёткого поиска (similarity, опечатки).
  // Создаётся один раз; при отсутствии прав выдаёт warning, но сервер стартует.
  try {
    await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    console.log('pg_trgm: OK');
  } catch (e) {
    console.warn('pg_trgm не активирован (нужны права superuser или уже включён):', e.message);
  }

  app.listen(PORT, () => {
    console.log(`Сервер Восход запущен: http://localhost:${PORT}`);
  });
}

bootstrap();
