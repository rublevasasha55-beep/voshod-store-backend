import { Router }    from 'express';
import jwt           from 'jsonwebtoken';
import QRCode        from 'qrcode';
import prisma        from '../prisma.js';
import { authenticate }        from '../middleware/authenticate.js';
import { generateEstimateHtml } from '../templates/estimatePrint.js';

const router = Router();

// Авторизация с поддержкой ?token= (нужно для открытия PDF в новой вкладке)
function authenticateExport(req, res, next) {
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = headerToken ?? req.query.token;

  if (!token) return res.status(401).json({ error: 'Необходима авторизация' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен или истёк' });
  }
}

// Хелпер: считает общий вес сметы по весу товаров
function calcTotalWeight(items) {
  return items.reduce((sum, item) => {
    const w = item.product?.weight ?? 0;
    return sum + w * item.quantity;
  }, 0);
}

// ─── GET /api/estimates ───────────────────────────────────────────────────────
// Список смет пользователя (с позициями, датой, общим весом)
router.get('/', authenticate, async (req, res) => {
  try {
    const estimates = await prisma.estimate.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { product: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    const result = estimates.map((e) => ({
      ...e,
      totalWeight: calcTotalWeight(e.items),
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения смет' });
  }
});

// ─── GET /api/estimates/:id ───────────────────────────────────────────────────
// Одна смета (с позициями и общим весом)
router.get('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const estimate = await prisma.estimate.findFirst({
      where: { id, userId: req.userId },
      include: {
        items: {
          include: { product: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!estimate) return res.status(404).json({ error: 'Смета не найдена' });

    res.json({ ...estimate, totalWeight: calcTotalWeight(estimate.items) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения сметы' });
  }
});

// ─── POST /api/estimates ──────────────────────────────────────────────────────
// Создать смету из выбранных позиций корзины (перемещение: cart → estimate)
// Body: { name }            — берёт isSelected=true позиции автоматически
// Body: { name, itemIds[] } — берёт только указанные CartItem.id
router.post('/', authenticate, async (req, res) => {
  const { name, itemIds } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название сметы' });

  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.userId },
      include: {
        items: {
          where: itemIds?.length
            ? { id: { in: itemIds.map(Number) } }
            : { isSelected: true },
          include: { product: true },
        },
      },
    });

    if (!cart || cart.items.length === 0)
      return res.status(400).json({ error: 'Нет выбранных товаров для сметы' });

    const estimate = await prisma.$transaction(async (tx) => {
      // 1. Создаём смету
      const est = await tx.estimate.create({
        data: {
          name: name.trim(),
          userId: req.userId,
          items: {
            create: cart.items.map((ci) => ({
              productId: ci.productId,
              quantity: ci.quantity,
            })),
          },
        },
        include: { items: { include: { product: true } } },
      });

      // 2. Удаляем позиции из корзины
      await tx.cartItem.deleteMany({
        where: { id: { in: cart.items.map((ci) => ci.id) } },
      });

      return est;
    });

    res.status(201).json({
      ...estimate,
      totalWeight: calcTotalWeight(estimate.items),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка создания сметы' });
  }
});

// ─── POST /api/estimates/:id/to-cart ─────────────────────────────────────────
// Скопировать все позиции сметы в текущую корзину
// Если товар уже в корзине — увеличивает quantity
router.post('/:id/to-cart', authenticate, async (req, res) => {
  const estimateId = Number(req.params.id);

  try {
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, userId: req.userId },
      include: { items: true },
    });

    if (!estimate) return res.status(404).json({ error: 'Смета не найдена' });

    const cart = await prisma.cart.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId },
      update: {},
    });

    // Upsert каждой позиции в корзину
    await prisma.$transaction(
      estimate.items.map((ei) =>
        prisma.cartItem.upsert({
          where: { cartId_productId: { cartId: cart.id, productId: ei.productId } },
          create: { cartId: cart.id, productId: ei.productId, quantity: ei.quantity },
          update: { quantity: { increment: ei.quantity } },
        })
      )
    );

    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: { product: true }, orderBy: { id: 'asc' } } },
    });

    res.json(updatedCart);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка копирования сметы в корзину' });
  }
});

// ─── PATCH /api/estimates/:id/items/:itemId ───────────────────────────────────
// Обновить quantity позиции в смете
// Body: { quantity }
router.patch('/:id/items/:itemId', authenticate, async (req, res) => {
  const estimateId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { quantity } = req.body;

  if (!quantity || quantity < 1)
    return res.status(400).json({ error: 'quantity должен быть >= 1' });

  try {
    const existing = await prisma.estimateItem.findFirst({
      where: { id: itemId, estimate: { id: estimateId, userId: req.userId } },
    });
    if (!existing) return res.status(404).json({ error: 'Позиция не найдена' });

    const item = await prisma.estimateItem.update({
      where: { id: itemId },
      data: { quantity },
      include: { product: true },
    });
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обновления позиции' });
  }
});

// ─── DELETE /api/estimates/:id/items/:itemId ──────────────────────────────────
// Удалить позицию из сметы
router.delete('/:id/items/:itemId', authenticate, async (req, res) => {
  const estimateId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  try {
    const existing = await prisma.estimateItem.findFirst({
      where: { id: itemId, estimate: { id: estimateId, userId: req.userId } },
    });
    if (!existing) return res.status(404).json({ error: 'Позиция не найдена' });

    await prisma.estimateItem.delete({ where: { id: itemId } });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления позиции' });
  }
});

// ─── GET /api/estimates/:id/export ───────────────────────────────────────────
// Печатная форма сметы в виде HTML (открывается в браузере / сохраняется как PDF).
// Авторизация: Bearer-токен в заголовке ИЛИ ?token=JWT в строке запроса.
// Опционально: ?print=1 — запустить window.print() сразу при открытии.
router.get('/:id/export', authenticateExport, async (req, res) => {
  const id        = Number(req.params.id);
  const autoPrint = req.query.print === '1';

  try {
    const estimate = await prisma.estimate.findFirst({
      where: { id, userId: req.userId },
      include: {
        user:  { select: { fullName: true, phone: true } },
        items: {
          include: { product: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!estimate) return res.status(404).json({ error: 'Смета не найдена' });

    // ── Расчёт итогов ──────────────────────────────────────────────────────
    const totalWeight = estimate.items.reduce(
      (s, i) => s + (i.product.weight ?? 0) * i.quantity,
      0,
    );
    const totalPrice = estimate.items.reduce(
      (s, i) => s + Number(i.product.price) * i.quantity,
      0,
    );
    const totalSavings = estimate.items.reduce((s, i) => {
      if (!i.product.oldPrice) return s;
      return s + (Number(i.product.oldPrice) - Number(i.product.price)) * i.quantity;
    }, 0);

    // ── QR-код (ссылка на смету в приложении) ─────────────────────────────
    const siteUrl      = process.env.SITE_URL || 'http://localhost:3000';
    const qrUrl        = `${siteUrl}/estimates/${id}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
      width:               120,
      margin:              1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0D1F3C', light: '#FFFFFF' },
    });

    // ── Генерация HTML ─────────────────────────────────────────────────────
    const html = generateEstimateHtml({
      estimate,
      totalWeight,
      totalPrice,
      totalSavings,
      qrCodeDataUrl,
      autoPrint,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="smeta-${id}.html"`,
    );
    res.send(html);
  } catch (error) {
    console.error('[estimate export]', error);
    res.status(500).json({ error: 'Ошибка генерации печатной формы' });
  }
});

// ─── DELETE /api/estimates/:id ────────────────────────────────────────────────
// Удалить смету целиком
router.delete('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const existing = await prisma.estimate.findFirst({
      where: { id, userId: req.userId },
    });
    if (!existing) return res.status(404).json({ error: 'Смета не найдена' });

    await prisma.estimate.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления сметы' });
  }
});

export default router;
