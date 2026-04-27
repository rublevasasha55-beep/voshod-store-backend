import { Router } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate); // все эндпоинты требуют авторизации

const BCRYPT_ROUNDS       = 10;
const OTP_EXPIRY_MINUTES  = 10;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS    = 3;

// ─── Хелперы: лояльность ──────────────────────────────────────────────────────

const LOYALTY_TIERS = [
  { name: 'BRONZE',   label: 'Бронза',  min: 0,    threshold: 500  },
  { name: 'SILVER',   label: 'Серебро', min: 500,  threshold: 2000 },
  { name: 'GOLD',     label: 'Золото',  min: 2000, threshold: 5000 },
  { name: 'PLATINUM', label: 'Платина', min: 5000, threshold: null },
];

const MAX_PROGRESS_POINTS = 5000; // 100% заливка

function getLoyaltyInfo(bonusPoints) {
  const current = [...LOYALTY_TIERS].reverse().find((t) => bonusPoints >= t.min)
    ?? LOYALTY_TIERS[0];

  const next = LOYALTY_TIERS.find((t) => t.min > bonusPoints) ?? null;

  return {
    tier:            current.name,
    tierLabel:       current.label,
    progressPercent: Math.min(Math.round((bonusPoints / MAX_PROGRESS_POINTS) * 100), 100),
    nextTier:        next?.name      ?? null,
    nextTierLabel:   next?.label     ?? null,
    pointsToNext:    next ? next.min - bonusPoints : 0,
    // Для UI-человечка: нормализованное значение 0.0–1.0
    fillRatio:       Math.min(bonusPoints / MAX_PROGRESS_POINTS, 1),
  };
}

// Карта лояльности: 16-значный номер из префикса 8888 + userId с паддингом
function getLoyaltyCard(userId, bonusPoints) {
  const raw     = `8888${String(userId % 1000000000000).padStart(12, '0')}`;
  const parts   = raw.match(/.{4}/g); // ['8888','0000','0000','0001']
  const full    = parts.join(' ');
  const masked  = `${parts[0]} **** **** ${parts[3]}`;

  return { number: full, numberMasked: masked, ...getLoyaltyInfo(bonusPoints) };
}

// OTP — 4 цифры
function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ─── GET /api/profile ─────────────────────────────────────────────────────────
// Полный профиль: данные пользователя + карта лояльности + сметы + статистика
router.get('/', async (req, res) => {
  try {
    const [user, estimatesRaw, ordersCount, reviewsCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          id: true, fullName: true, phone: true, email: true,
          bonusPoints: true, role: true, acceptedTerms: true, createdAt: true,
        },
      }),
      prisma.estimate.findMany({
        where:   { userId: req.userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          items: { include: { product: { select: { price: true, quantity: true } } } },
          _count: { select: { items: true } },
        },
      }),
      prisma.order.count({ where: { userId: req.userId } }),
      prisma.review.count({ where: { userId: req.userId } }),
    ]);

    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    // Считаем totalPrice для каждой сметы в JS
    const estimates = estimatesRaw.map((e) => {
      const totalPrice = e.items.reduce(
        (sum, i) => sum + Number(i.product.price) * i.quantity, 0,
      );
      return {
        id:         e.id,
        name:       e.name,
        createdAt:  e.createdAt,
        itemCount:  e._count.items,
        totalPrice: Math.round(totalPrice * 100) / 100,
      };
    });

    res.json({
      user: {
        ...user,
        loyaltyCard: getLoyaltyCard(user.id, user.bonusPoints),
      },
      estimates,
      stats: {
        totalOrders:    ordersCount,
        totalReviews:   reviewsCount,
        totalEstimates: estimatesRaw.length,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения профиля' });
  }
});

// ─── PATCH /api/profile ───────────────────────────────────────────────────────
// Обновить имя и/или email
// Body: { fullName?, email? }
router.patch('/', async (req, res) => {
  const { fullName, email } = req.body;
  const data = {};
  if (fullName !== undefined) data.fullName = fullName.trim() || null;
  if (email    !== undefined) {
    // Проверим, не занят ли email другим пользователем
    if (email) {
      const taken = await prisma.user.findFirst({
        where: { email, NOT: { id: req.userId } },
      });
      if (taken) return res.status(400).json({ error: 'Этот email уже используется' });
    }
    data.email = email.trim() || null;
  }

  if (Object.keys(data).length === 0)
    return res.status(400).json({ error: 'Нет данных для обновления' });

  try {
    const updated = await prisma.user.update({
      where:  { id: req.userId },
      data,
      select: { id: true, fullName: true, email: true, phone: true, bonusPoints: true },
    });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

// ─── POST /api/profile/change-password ───────────────────────────────────────
// Смена пароля (текущий пароль обязателен)
// Body: { currentPassword, newPassword }
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Оба поля обязательны' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'Новый пароль — минимум 6 символов' });

  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { password: true },
    });

    if (!user?.password)
      return res.status(400).json({ error: 'У вашего аккаунта не установлен пароль' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid)
      return res.status(400).json({ error: 'Текущий пароль неверен' });

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: req.userId }, data: { password: hashed } });

    res.json({ ok: true, message: 'Пароль успешно изменён' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка смены пароля' });
  }
});

// ─── POST /api/profile/request-phone-otp ─────────────────────────────────────
// Шаг 1: запросить OTP для смены телефона.
// Body: { newPhone }
router.post('/request-phone-otp', async (req, res) => {
  const { newPhone } = req.body;
  if (!newPhone) return res.status(400).json({ error: 'newPhone обязателен' });

  try {
    // Проверяем cooldown
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { otpLastSent: true, phone: true },
    });

    if (user.phone === newPhone)
      return res.status(400).json({ error: 'Это уже ваш текущий номер' });

    const taken = await prisma.user.findUnique({ where: { phone: newPhone } });
    if (taken) return res.status(400).json({ error: 'Этот номер уже занят другим аккаунтом' });

    if (user.otpLastSent) {
      const elapsed = (Date.now() - new Date(user.otpLastSent).getTime()) / 1000;
      if (elapsed < OTP_COOLDOWN_SECONDS) {
        const wait = Math.ceil(OTP_COOLDOWN_SECONDS - elapsed);
        return res.status(429).json({
          error: `Подождите ${wait} сек. перед повторной отправкой`,
          waitSeconds: wait,
        });
      }
    }

    const code    = generateOtp();
    const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.user.update({
      where: { id: req.userId },
      data: { otpCode: code, otpExpires: expires, otpAttempts: 0, otpLastSent: new Date() },
    });

    // В продакшене — отправить SMS на newPhone
    console.log(`\n📱  OTP для смены телефона (${newPhone}): ${code}\n`);

    res.json({ message: 'Код отправлен на новый номер', phone: newPhone });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка запроса OTP' });
  }
});

// ─── POST /api/profile/confirm-phone-change ───────────────────────────────────
// Шаг 2: подтвердить смену телефона кодом.
// Body: { newPhone, otpCode }
router.post('/confirm-phone-change', async (req, res) => {
  const { newPhone, otpCode } = req.body;
  if (!newPhone || !otpCode)
    return res.status(400).json({ error: 'newPhone и otpCode обязательны' });

  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { otpCode: true, otpExpires: true, otpAttempts: true, phone: true },
    });

    if (!user.otpCode)
      return res.status(400).json({ error: 'Сначала запросите код подтверждения' });

    if (new Date() > user.otpExpires)
      return res.status(400).json({ error: 'Код истёк — запросите новый' });

    if (user.otpAttempts >= OTP_MAX_ATTEMPTS)
      return res.status(429).json({ error: 'Слишком много попыток — запросите новый код' });

    if (user.otpCode !== String(otpCode)) {
      await prisma.user.update({
        where: { id: req.userId },
        data:  { otpAttempts: { increment: 1 } },
      });
      const left = OTP_MAX_ATTEMPTS - (user.otpAttempts + 1);
      return res.status(400).json({ error: `Неверный код. Осталось попыток: ${left}`, attemptsLeft: left });
    }

    // Повторная проверка: номер ещё не занят?
    const taken = await prisma.user.findUnique({ where: { phone: newPhone } });
    if (taken && taken.id !== req.userId)
      return res.status(400).json({ error: 'Этот номер уже занят' });

    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: {
        phone:       newPhone,
        otpCode:     null,
        otpExpires:  null,
        otpAttempts: 0,
      },
      select: { id: true, phone: true, email: true, fullName: true },
    });

    res.json({ ok: true, message: 'Номер телефона успешно изменён', user: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка подтверждения смены телефона' });
  }
});

export default router;
