/**
 * Восход — сид базы данных
 * Запуск: npm run seed  (или npx prisma db seed)
 *
 * Иерархия категорий:
 *   L1: Двери, окна, панели
 *    └─ L2: Панели
 *        ├─ L3: Панели ПВХ   (800300xx — листовые/дизайнерские)
 *        └─ L3: Мозаика      (800400xx — Bonaparte керамогранит/стекло + Grace самоклейка)
 */

import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';

const { PrismaClient } = pkg;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ─── Утилиты ──────────────────────────────────────────────────────────────────

async function upsertCategory({ slug, name, level, parentId = null, image = null, icon = null }) {
  return prisma.category.upsert({
    where:  { slug },
    create: { slug, name, level, parentId, image, icon },
    update: { name, level, parentId, image, icon },
  });
}

async function upsertProduct(data) {
  const { sku, ...rest } = data;
  return prisma.product.upsert({
    where:  { sku },
    create: { sku, ...rest },
    update: { ...rest },
  });
}

// ─── Категории ────────────────────────────────────────────────────────────────

async function seedCategories() {
  // ── L1 ──────────────────────────────────────────────────────────────────────
  const doorsWindows = await upsertCategory({
    slug:  'doors-windows',
    name:  'Двери, окна, панели',
    level: 1,
    image: '/img/categories/doors-windows.png',
  });

  // ── L2 ──────────────────────────────────────────────────────────────────────
  const panelsGroup = await upsertCategory({
    slug:     'panels',
    name:     'Панели',
    level:    2,
    parentId: doorsWindows.id,
    icon:     '/img/icons/panels.svg',
  });

  // ── L3 (листовые узлы — привязываются товары) ────────────────────────────────
  const panelsPvc = await upsertCategory({
    slug:     'panels-pvc',
    name:     'Панели ПВХ',
    level:    3,
    parentId: panelsGroup.id,
  });

  const panelsMosaic = await upsertCategory({
    slug:     'panels-mosaic',
    name:     'Мозаика',
    level:    3,
    parentId: panelsGroup.id,
  });

  console.log('✅  Категории: OK');
  return { panelsPvc, panelsMosaic };
}

// ─── Товары ───────────────────────────────────────────────────────────────────

async function seedProducts({ panelsPvc, panelsMosaic }) {
  const products = [

    // ══ ПАНЕЛИ ПВХ (800300xx) ═════════════════════════════════════════════════

    {
      sku:         '80030001',
      name:        'Панель ПВХ Stella Мрамор Крестола (250x2600x5 мм)',
      description: 'Влагостойкое интерьерное решение для финишной отделки стен. Бесшовная технология соединения создает эффект монолитного мраморного полотна. Глянцевое лакированное покрытие защищает термопечать от истирания и облегчает уход.',
      price:       240.00,
      stock:       50,
      weight:      0.83,
      unit:        'PCS',
      images:      [
        '/categories/products/dw/80030001_1.png',
        '/categories/products/dw/80030001_2.png',
      ],
      rooms: ['bathroom', 'kitchen', 'corridor'],
      characteristics: {
        brand:      'Stella',
        collection: 'Slim Light',
        size:       '2600 x 250 x 5',
        material:   'ПВХ',
        texture:    'Мрамор (Крестола)',
        finish:     'Глянцевое',
        jointType:  'Бесшовный',
        weight:     '0.83 кг',
        coverage:   '0.65 м²',
        ean13:      '4604400100455',
      },
      categoryId: panelsPvc.id,
    },

    {
      sku:         '80030002',
      name:        'Панель ПВХ Stella Кирпич Барокко (250x2600x5 мм)',
      description: 'Современная интерпретация классической кирпичной кладки. Глянцевая панель с бесшовным соединением и 100% влагостойкостью. Рисунок имитирует фактуру кирпича, добавляя интерьеру структурности без лишней пыли.',
      price:       340.00,
      stock:       150,
      weight:      0.83,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80030002_1.png',
        '/categories/products/dw/80030002_2.png',
      ],
      rooms: ['bathroom', 'kitchen', 'corridor', 'balcony'],
      characteristics: {
        brand:      'Stella',
        collection: 'Slim',
        size:       '2600 x 250 x 5',
        material:   'ПВХ',
        texture:    'Кирпич (Барокко)',
        finish:     'Глянцевое',
        jointType:  'Бесшовный',
        printType:  'Термопечать',
        weight:     '0.83 кг',
        coverage:   '0.65 м²',
        ean13:      '4604400100462',
      },
      categoryId: panelsPvc.id,
    },

    {
      sku:         '80030003',
      name:        'Панель ПВХ Stella Light «Винтаж» 8 мм (250x2700x8 мм)',
      description: 'Стильное решение с изящным узором «Винтаж». Благодаря увеличенной толщине 8 мм материал обладает повышенной прочностью. Глянцевая поверхность и бесшовное соединение создают эффект монолитной стены, визуально расширяя пространство.',
      price:       349.00,
      stock:       100,
      weight:      0.94,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80030003_1.png',
        '/categories/products/dw/80030003_2.png',
      ],
      rooms: ['bathroom', 'kitchen', 'balcony'],
      characteristics: {
        brand:      'Stella',
        collection: 'Light',
        size:       '2700 x 250 x 8',
        material:   'ПВХ',
        texture:    'Узоры (Винтаж)',
        finish:     'Глянцевое',
        jointType:  'Бесшовный',
        weight:     '0.94 кг',
        coverage:   '0.675 м²',
      },
      categoryId: panelsPvc.id,
    },

    {
      sku:         '80030004',
      name:        'Панель ПВХ Venta матовая белая 10 мм (250x3000x10 мм)',
      description: 'Универсальное решение для стен и потолков. Белоснежная матовая поверхность создает аккуратный фон. Благодаря толщине 10 мм панель обладает повышенной прочностью, а длина 3 метра идеальна для высоких помещений.',
      price:       411.00,
      stock:       200,
      weight:      1.5,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80030004_1.png',
        '/categories/products/dw/80030004_2.png',
      ],
      rooms: ['bathroom', 'corridor', 'basement'],
      characteristics: {
        brand:     'Venta',
        size:      '3000 x 250 x 10',
        material:  'ПВХ',
        texture:   'Матовая',
        color:     'Белый',
        jointType: 'Бесшовный',
        weight:    '1.5 кг',
        coverage:  '0.75 м²',
        ean13:     '4604400100486',
      },
      categoryId: panelsPvc.id,
    },

    {
      sku:         '80030005',
      name:        'Панель ПВХ Grace Бело-серый камень 3 мм (980x500x3 мм)',
      description: 'Реалистичная цифровая печать под натуральный камень с рельефной фактурой. Идеально для быстрого обновления кухни или ванной. Монтаж на клей, матовая влагостойкая поверхность.',
      price:       211.00,
      stock:       300,
      weight:      0.2,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80030005_1.png',
        '/categories/products/dw/80030005_2.png',
      ],
      rooms: ['kitchen', 'bathroom', 'corridor'],
      characteristics: {
        brand:          'Grace',
        size:           '980 x 500 x 3',
        availableSizes: ['980x500', '982x500'],
        material:       'ПВХ',
        texture:        'Рельефная (Камень)',
        finish:         'Матовая',
        mountType:      'На клей',
        weight:         '0.2 кг',
        coverage:       '0.49 м²',
        ean13:          '4604400100493',
      },
      categoryId: panelsPvc.id,
    },

    {
      sku:         '80030006',
      name:        'Панель ПВХ Grace Ракушечник светлый 3 мм (980x498x3 мм)',
      description: 'Имитация натурального ракушечника в светло-бежевой гамме. Рельефная матовая поверхность и цифровая печать высокого разрешения. Быстрый монтаж на клей без спец-инструмента.',
      price:       211.00,
      stock:       250,
      weight:      0.2,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80030006_1.png',
        '/categories/products/dw/80030006_2.png',
      ],
      rooms: ['bathroom', 'kitchen', 'corridor'],
      characteristics: {
        brand:          'Grace',
        size:           '980 x 498 x 3',
        availableSizes: ['980x498', '982x498'],
        material:       'ПВХ',
        texture:        'Рельефная (Ракушечник)',
        finish:         'Матовая',
        mountType:      'На клей',
        weight:         '0.2 кг',
        coverage:       '0.49 м²',
        ean13:          '4604400100509', // исходный "460440010050" был 12 цифр — исправлен на 13
      },
      categoryId: panelsPvc.id,
    },

    {
      sku:         '80030007',
      name:        'Панель ПВХ Grace Восточный витраж 3 мм (964x484x3 мм)',
      description: 'Яркое решение для кухонного фартука или ванной. Имитация мелкоформатной плитки с восточными орнаментами. Рельефная матовая фактура выглядит как настоящая керамика, но монтируется на клей в разы быстрее.',
      price:       211.00,
      stock:       120,
      weight:      0.2,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80030007_1.png',
        '/categories/products/dw/80030007_2.png',
      ],
      rooms: ['kitchen', 'bathroom'],
      characteristics: {
        brand:          'Grace',
        size:           '964 x 484 x 3',
        availableSizes: ['964x484', '960x482', '957x480'],
        material:       'ПВХ',
        texture:        'Рельефная (Плитка/Орнамент)',
        color:          'Бирюзовый',
        finish:         'Матовая',
        mountType:      'На клей',
        weight:         '0.2 кг',
        coverage:       '0.47 м²',
      },
      categoryId: panelsPvc.id,
    },

    // ══ МОЗАИКА (800400xx) ════════════════════════════════════════════════════

    {
      sku:         '80040001',
      name:        'Мозаика Bonaparte Вива Адмира (30.3x30.3 см)',
      description: 'Премиальная декоративная мозаика на гибком ПВХ-основании. Сочетание прочного керамогранита и удобной подложки позволяет облицовывать даже изогнутые поверхности. Разноцветная палитра в бежево-коричневых тонах и квадратные ячейки создают классический, но динамичный ритм. Морозостойкость позволяет использовать её и для фасадных работ.',
      price:       627.00,
      stock:       85,
      weight:      1.7,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80040001_1.png',
        '/categories/products/dw/80040001_2.png',
      ],
      rooms: ['bathroom', 'kitchen', 'living_room', 'pool', 'outdoor'],
      characteristics: {
        brand:           'Bonaparte',
        size:            '303 x 303 x 6',
        cellSize:        '48 x 48',
        material:        'Керамогранит',
        baseMaterial:    'ПВХ',
        texture:         'Камень',
        color:           'Бежево-коричневый',
        shape:           'Квадрат',
        usage:           'Внутренний / наружный',
        frostResistance: 'Да',
        weight:          '1.7 кг',
        origin:          'Китай',
      },
      categoryId: panelsMosaic.id,
    },

    {
      sku:         '80040002',
      name:        'Мозаика Bonaparte Вива Адмира Бордо (30.3x30.3 см)',
      description: 'Премиальная мозаика из керамогранита на ПВХ-сетке. Глубокий бордовый цвет идеально подходит для создания роскошных акцентных зон. Благодаря гибкому основанию легко облицовывает изогнутые элементы декора и ниши. Морозостойкая и влагостойкая.',
      price:       645.00,
      stock:       45,
      weight:      1.7,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80040002_1.png',
        '/categories/products/dw/80040002_2.png',
      ],
      rooms: ['bathroom', 'living_room', 'kitchen'],
      characteristics: {
        brand:           'Bonaparte',
        size:            '303 x 303 x 6',
        cellSize:        '48 x 48',
        material:        'Керамогранит',
        baseMaterial:    'ПВХ',
        texture:         'Камень',
        color:           'Бордовый',
        shape:           'Квадрат',
        usage:           'Внутренний / наружный',
        frostResistance: 'Да',
        weight:          '1.7 кг',
        origin:          'Китай',
      },
      categoryId: panelsMosaic.id,
    },

    {
      sku:         '80040003',
      name:        'Мозаика Bonaparte Вива Адмира Серо-голубая (30.3x30.3 см)',
      description: 'Трёхцветная композиция из голубых, серых и бежевых ячеек. Создаёт эффект натуральной морской гальки. Идеальна для ванных комнат, душевых зон и бассейнов. Прочный керамогранит устойчив к перепадам температур и химическим средствам.',
      price:       627.00,
      stock:       60,
      weight:      1.7,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80040003_1.png',
        '/categories/products/dw/80040003_2.png',
      ],
      rooms: ['bathroom', 'pool', 'kitchen'],
      characteristics: {
        brand:           'Bonaparte',
        size:            '303 x 303 x 6',
        cellSize:        '48 x 48',
        material:        'Керамогранит',
        baseMaterial:    'ПВХ',
        texture:         'Камень',
        color:           'Серо-голубой (микс)',
        shape:           'Квадрат',
        usage:           'Внутренний / наружный',
        frostResistance: 'Да',
        weight:          '1.7 кг',
        origin:          'Китай',
      },
      categoryId: panelsMosaic.id,
    },

    {
      sku:         '80040004',
      name:        'Мозаика Bonaparte Вива Чёрная роза (30x30 см)',
      description: 'Элегантная стеклянная мозаика в глубоком чёрном цвете. Мелкая ячейка 25x25 мм создаёт эффект искрящегося полотна. Стеклянная основа абсолютно не впитывает влагу — идеальна для душевых кабин, чаш бассейнов и кухонных фартуков. Гибкое ПВХ-основание позволяет оформлять углы и изгибы, морозостойкость гарантирует долговечность при наружной отделке.',
      price:       964.00,
      stock:       100,
      weight:      1.5,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80040004_1.png',
        '/categories/products/dw/80040004_2.png',
      ],
      rooms: ['bathroom', 'pool', 'kitchen', 'outdoor'],
      characteristics: {
        brand:           'Bonaparte',
        size:            '300 x 300 x 3.5',
        cellSize:        '25 x 25',
        material:        'Стекло',
        baseMaterial:    'ПВХ',
        texture:         'Глянцевая',
        color:           'Чёрный',
        shape:           'Квадрат',
        usage:           'Внутренний / наружный',
        frostResistance: 'Да',
        weight:          '1.5 кг',
        origin:          'Китай',
      },
      categoryId: panelsMosaic.id,
    },

    {
      sku:         '80040005',
      name:        'Мозаика самоклеящаяся Grace Белая (480x480x3 мм)',
      description: 'Инновационный формат мозаики для тех, кто ценит время. Панель с готовым клеевым слоем — не нужен клей и услуги мастеров. Белоснежная матовая поверхность с рельефными ячейками создаёт современный вид. Влагостойкий ПВХ позволяет использовать её даже в зонах прямого попадания воды.',
      price:       185.00,
      stock:       450,
      weight:      0.2,
      unit:        'PCS',
      images: [
        '/categories/products/dw/80040005_1.png',
        '/categories/products/dw/80040005_2.png',
      ],
      rooms: ['bathroom', 'kitchen', 'corridor', 'balcony'],
      characteristics: {
        brand:      'Grace',
        size:       '480 x 480 x 3',
        material:   'ПВХ',
        texture:    'Рельефная мозаика',
        color:      'Белый',
        finish:     'Матовая',
        mountType:  'Самоклеящаяся основа',
        printType:  'Цифровая печать',
        weight:     '0.2 кг',
        coverage:   '0.23 м²',
        origin:     'Россия',
      },
      categoryId: panelsMosaic.id,
    },

  ];

  for (const p of products) {
    const saved = await upsertProduct(p);
    console.log(`  ✔  ${saved.sku}  ${saved.name}`);
  }

  console.log(`\n✅  Товаров добавлено/обновлено: ${products.length}`);
}

// ─── Запуск ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱  Сид Восход — запуск...\n');
  const categories = await seedCategories();
  await seedProducts(categories);
  console.log('\n✅  Сид завершён.\n');
}

main()
  .catch((e) => {
    console.error('❌  Ошибка сида:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
